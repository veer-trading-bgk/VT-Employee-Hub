'use client';

import { useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Send, CalendarDays, FileText,
  CheckCircle2, AlertCircle, Loader2, RefreshCw, Users, ShieldCheck,
  XCircle, ArrowRight, Eye, EyeOff,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Drawer } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { AudienceBuilder } from './AudienceBuilder';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { STAGE_LABELS, type Stage } from '@/types/v3';
import type {
  CampaignType, CampaignObjective, ScheduleMode,
  CampaignFormData, CampaignResponse, LaunchResponse, AudienceFilter,
  AudiencePreviewResponse, ValidateAudienceResponse,
} from '@/types/campaigns';

// ── Types ──────────────────────────────────────────────────────────────────

interface WaTemplate {
  id:            string;
  name:          string;
  templateName:  string;
  status:        string;
  category:      string;
  language:      string;
  components?:   Array<{ type: string; format?: string; text?: string; example?: { header_text?: string[] } }> | null;
}

interface WaTemplatesResponse {
  success:   boolean;
  templates: WaTemplate[];
}

type LaunchPhase = 'idle' | 'validating' | 'ready' | 'invalid';

// ── Constants ──────────────────────────────────────────────────────────────

const STEP_LABELS = ['Info', 'Audience', 'Template', 'Schedule', 'Review'] as const;

const EMPTY_FORM: CampaignFormData = {
  name: '', description: '', type: 'whatsapp_broadcast', objective: 'awareness', tags: [],
  filter: {}, templateId: '', templateName: '', variableValues: [], headerVariableValue: '',
  scheduleMode: 'now', scheduledAt: '',
};

// ── Root component ─────────────────────────────────────────────────────────

export interface CampaignCreateDrawerProps {
  open:    boolean;
  onClose: () => void;
}

export function CampaignCreateDrawer({ open, onClose }: CampaignCreateDrawerProps) {
  const [step, setStep]                     = useState(0);
  const [form, setForm]                     = useState<CampaignFormData>(EMPTY_FORM);
  const [result, setResult]                 = useState<LaunchResponse | null>(null);
  const [launchPhase, setLaunchPhase]       = useState<LaunchPhase>('idle');
  const [validation, setValidation]         = useState<ValidateAudienceResponse | null>(null);
  const qc = useQueryClient();

  // Templates — only fetched on step 2
  const { data: tmplData, isLoading: tmplLoading } = useQuery<WaTemplatesResponse>({
    queryKey: ['wa-templates'],
    queryFn:  () => apiFetch('/api/whatsapp/templates'),
    enabled:  open && step === 2,
    staleTime: 5 * 60 * 1000,
  });
  const approvedTemplates = (tmplData?.templates ?? []).filter((t) => t.status === 'APPROVED');
  const selectedTemplate  = approvedTemplates.find((t) => t.id === form.templateId) ?? null;

  // Audience preview — lifted here so the Launch button can read the count.
  // staleTime:0 ensures a fresh fetch every time the user lands on step 4.
  const { data: audienceData, isLoading: audienceLoading } = useQuery<AudiencePreviewResponse>({
    queryKey: ['audience-review', JSON.stringify(form.filter)],
    queryFn:  () => apiFetch<AudiencePreviewResponse>('/api/campaigns/audience/preview', {
      method: 'POST',
      body:   JSON.stringify({ filter: form.filter }),
    }),
    enabled:   open && step === 4,
    staleTime: 0,
    retry: 1,
  });

  function handleClose() {
    setStep(0);
    setForm(EMPTY_FORM);
    setResult(null);
    setLaunchPhase('idle');
    setValidation(null);
    onClose();
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    qc.invalidateQueries({ queryKey: ['campaign-stats'] });
  }

  function resetToReview() {
    setLaunchPhase('idle');
    setValidation(null);
    // Force audience query to refetch with the latest data
    qc.invalidateQueries({ queryKey: ['audience-review'] });
  }

  // ── Validate audience before launch ──────────────────────────────────────
  const validateMutation = useMutation({
    mutationFn: () =>
      apiFetch<ValidateAudienceResponse>('/api/campaigns/audience/validate', {
        method: 'POST',
        body:   JSON.stringify({
          filter:           form.filter,
          reviewCount:      audienceData?.count ?? 0,
          reviewRecipients: audienceData?.recipients ?? undefined,
        }),
      }),
    onSuccess: (res) => {
      setValidation(res);
      setLaunchPhase(res.valid ? 'ready' : 'invalid');
    },
    onError: () => {
      toast.error('Audience validation failed. Please try again.');
      setLaunchPhase('idle');
    },
  });

  // ── Save as draft / scheduled ─────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (payload: { status: 'draft' | 'scheduled' }) =>
      apiFetch<CampaignResponse>('/api/campaigns', {
        method: 'POST',
        body:   JSON.stringify({
          name:                form.name,
          description:         form.description || null,
          type:                form.type,
          objective:           form.objective,
          tags:                form.tags,
          audience:            { filter: form.filter },
          templateId:          form.templateId  || null,
          templateName:        form.templateName || null,
          variableValues:      form.variableValues,
          headerVariableValue: form.headerVariableValue || null,
          scheduledAt:         payload.status === 'scheduled' ? form.scheduledAt : null,
        }),
      }),
    onSuccess: (_, { status }) => {
      invalidateAll();
      toast.success(status === 'draft' ? 'Campaign saved as draft' : 'Campaign scheduled');
      handleClose();
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to save'),
  });

  // ── Create then immediately launch (called only after valid validation) ───
  const launchMutation = useMutation({
    mutationFn: async () => {
      const validatedCount = validation?.currentCount ?? audienceData?.count ?? 0;
      const created = await apiFetch<CampaignResponse>('/api/campaigns', {
        method: 'POST',
        body:   JSON.stringify({
          name:                form.name,
          description:         form.description || null,
          type:                form.type,
          objective:           form.objective,
          tags:                form.tags,
          audience:            { filter: form.filter },
          templateId:          form.templateId  || null,
          templateName:        form.templateName || null,
          variableValues:      form.variableValues,
          headerVariableValue: form.headerVariableValue || null,
        }),
      });
      return apiFetch<LaunchResponse>(`/api/campaigns/${created.campaign.id}/launch`, {
        method: 'POST',
        body:   JSON.stringify({ reviewCount: validatedCount }),
      });
    },
    onSuccess: (r) => { invalidateAll(); setLaunchPhase('idle'); setResult(r); },
    onError:   (err: Error) => {
      toast.error(err.message ?? 'Launch failed');
      setLaunchPhase('idle');
    },
  });

  const canNext = useCallback(() => {
    if (step === 0) return form.name.trim().length > 0;
    if (step === 2) return form.type === 'ctwa' || (form.templateId?.length ?? 0) > 0;
    if (step === 3) return form.scheduleMode !== 'scheduled' || form.scheduledAt.length > 0;
    return true;
  }, [step, form]);

  const canLaunch = !audienceLoading && (audienceData?.count ?? 0) > 0 && !audienceData?.exceedsLimit;

  const isWizardLoading = saveMutation.isPending || validateMutation.isPending;
  const isLaunchLoading = launchMutation.isPending;

  // Drawer title / description change with phase
  const drawerTitle       = launchPhase === 'ready'   ? 'Campaign Ready'    :
                            launchPhase === 'invalid'  ? 'Audience Changed'  : 'Create Campaign';
  const drawerDescription = launchPhase === 'idle'    ? `Step ${step + 1} of ${STEP_LABELS.length} — ${STEP_LABELS[step]}` : undefined;

  // ── Success screen ────────────────────────────────────────────────────────
  if (result) {
    return (
      <Drawer open={open} onClose={handleClose} title="Campaign Launched" width={480}>
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-100 dark:bg-success-900/30">
            <CheckCircle2 className="h-8 w-8 text-success-600 dark:text-success-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-neutral-900 dark:text-white">"{form.name}" is live</p>
            <p className="mt-1 text-sm text-neutral-500">{result.total} recipients targeted</p>
          </div>
          <div className="grid w-full grid-cols-3 gap-3">
            {[
              { label: 'Sent',   value: result.sent,   color: 'text-success-600' },
              { label: 'Failed', value: result.failed, color: 'text-error-600'   },
              { label: 'Total',  value: result.total,  color: 'text-neutral-900 dark:text-white' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
                <p className="text-xs text-neutral-500">{s.label}</p>
              </div>
            ))}
          </div>
          {result.errors.length > 0 && (
            <div className="w-full rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 dark:border-warning-800 dark:bg-warning-900/20">
              <p className="text-xs text-warning-700 dark:text-warning-400">
                {result.errors.length} send{result.errors.length !== 1 ? 's' : ''} failed. Review campaign history for details.
              </p>
            </div>
          )}
          <Button variant="primary" onClick={handleClose}>Done</Button>
        </div>
      </Drawer>
    );
  }

  // Wizard footer — hidden while showing validation result screens
  const wizardFooter = launchPhase === 'idle' || launchPhase === 'validating' ? (
    <div className="flex items-center justify-between gap-2">
      <div className="flex gap-1.5">
        {STEP_LABELS.map((_, i) => (
          <div key={i} className={cn(
            'h-1.5 w-6 rounded-full transition-colors',
            i === step ? 'bg-primary-600' : i < step ? 'bg-primary-200' : 'bg-neutral-200 dark:bg-neutral-700',
          )} />
        ))}
      </div>
      <div className="flex gap-2">
        {step === 0 && (
          <Button variant="secondary" size="sm" onClick={handleClose} type="button">Cancel</Button>
        )}
        {step > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setStep((s) => s - 1)} type="button"
            iconLeft={<ChevronLeft className="h-4 w-4" />}>
            Back
          </Button>
        )}
        {step < STEP_LABELS.length - 1 && (
          <Button variant="primary" size="sm" onClick={() => setStep((s) => s + 1)} disabled={!canNext()}
            iconRight={<ChevronRight className="h-4 w-4" />}>
            Next
          </Button>
        )}
        {step === STEP_LABELS.length - 1 && (
          <>
            <Button variant="secondary" size="sm" loading={saveMutation.isPending} disabled={isWizardLoading}
              onClick={() => saveMutation.mutate({ status: 'draft' })} type="button">
              Save Draft
            </Button>
            {form.scheduleMode === 'now' && (
              <Button
                variant="primary" size="sm"
                loading={validateMutation.isPending}
                disabled={isWizardLoading || !canLaunch}
                iconLeft={<Send className="h-4 w-4" />}
                onClick={() => { setLaunchPhase('validating'); validateMutation.mutate(); }}
              >
                Launch Now
              </Button>
            )}
            {form.scheduleMode === 'scheduled' && (
              <Button variant="primary" size="sm" loading={saveMutation.isPending}
                disabled={isWizardLoading || !form.scheduledAt}
                iconLeft={<CalendarDays className="h-4 w-4" />}
                onClick={() => saveMutation.mutate({ status: 'scheduled' })}>
                Schedule
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  ) : undefined;

  // ── Wizard ────────────────────────────────────────────────────────────────
  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={drawerTitle}
      description={drawerDescription}
      width={520}
      confirmClose={form.name.length > 0 && launchPhase === 'idle'}
      footer={wizardFooter}
    >
      {/* ── Normal wizard steps ── */}
      {(launchPhase === 'idle' || launchPhase === 'validating') && (
        <>
          {step === 0 && <StepInfo form={form} onChange={setForm} />}
          {step === 1 && <AudienceBuilder value={form.filter} onChange={(filter) => setForm((f) => ({ ...f, filter }))} />}
          {step === 2 && (
            <StepTemplate
              form={form}
              onChange={setForm}
              templates={approvedTemplates}
              isLoading={tmplLoading}
              selectedTemplate={selectedTemplate}
            />
          )}
          {step === 3 && <StepSchedule form={form} onChange={setForm} />}
          {step === 4 && (
            <StepReview
              form={form}
              selectedTemplate={selectedTemplate}
              audienceData={audienceData}
              audienceLoading={audienceLoading}
            />
          )}
        </>
      )}

      {/* ── Validation passed: Campaign Ready ── */}
      {launchPhase === 'ready' && validation && (
        <CampaignReadyView
          form={form}
          validation={validation}
          isLaunching={isLaunchLoading}
          onLaunch={() => launchMutation.mutate()}
          onCancel={resetToReview}
        />
      )}

      {/* ── Validation failed: Audience Changed ── */}
      {launchPhase === 'invalid' && validation && (
        <AudienceChangedView
          validation={validation}
          onRefresh={resetToReview}
          onCancel={resetToReview}
        />
      )}
    </Drawer>
  );
}

// ── Step 1: Campaign Info ──────────────────────────────────────────────────

const CAMPAIGN_TYPES: Array<{ value: CampaignType; label: string; desc: string }> = [
  { value: 'whatsapp_broadcast', label: 'WhatsApp Broadcast', desc: 'Send a template message to multiple contacts at once' },
  { value: 'ctwa',              label: 'Click-to-WhatsApp',  desc: 'Meta Ads that open a WhatsApp conversation'          },
];

const OBJECTIVES: Array<{ value: CampaignObjective; label: string }> = [
  { value: 'awareness',  label: 'Awareness'  },
  { value: 'engagement', label: 'Engagement' },
  { value: 'conversion', label: 'Conversion' },
];

function StepInfo({
  form, onChange,
}: { form: CampaignFormData; onChange: React.Dispatch<React.SetStateAction<CampaignFormData>> }) {
  function set<K extends keyof CampaignFormData>(k: K, v: CampaignFormData[K]) {
    onChange((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Campaign Name <span className="text-error-500">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Diwali Demat Offer 2026"
          maxLength={120}
          autoFocus
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Internal notes about this campaign…"
          rows={2}
          className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Campaign Type</p>
        <div className="space-y-2">
          {CAMPAIGN_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              onClick={() => set('type', ct.value)}
              className={cn(
                'w-full rounded-lg border p-3 text-left transition-colors',
                form.type === ct.value
                  ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20'
                  : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-750',
              )}
            >
              <p className={cn('text-sm font-medium', form.type === ct.value ? 'text-primary-700 dark:text-primary-300' : 'text-neutral-900 dark:text-neutral-100')}>
                {ct.label}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">{ct.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Objective</p>
        <div className="flex gap-2">
          {OBJECTIVES.map((obj) => (
            <button
              key={obj.value}
              type="button"
              onClick={() => set('objective', obj.value)}
              className={cn(
                'flex-1 rounded-lg border py-2 text-sm font-medium transition-colors',
                form.objective === obj.value
                  ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900/20 dark:text-primary-300'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400',
              )}
            >
              {obj.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Template Selection ─────────────────────────────────────────────

function extractBodyVars(template: WaTemplate): number {
  const body = (template.components ?? []).find((c) => c.type === 'BODY');
  if (!body?.text) return 0;
  return (body.text.match(/\{\{\d+\}\}/g) ?? []).length;
}

function StepTemplate({
  form, onChange, templates, isLoading, selectedTemplate,
}: {
  form:             CampaignFormData;
  onChange:         React.Dispatch<React.SetStateAction<CampaignFormData>>;
  templates:        WaTemplate[];
  isLoading:        boolean;
  selectedTemplate: WaTemplate | null;
}) {
  if (form.type === 'ctwa') {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20">
          <FileText className="h-7 w-7 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <p className="font-medium text-neutral-900 dark:text-white">Template configured via Meta Ads Manager</p>
          <p className="mt-1 text-sm text-neutral-500 max-w-xs">
            CTWA ads use Meta's ad creative system. Set the WhatsApp message template inside your Meta Business Suite.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="py-10 text-center">
        <FileText className="mx-auto h-10 w-10 text-neutral-300" />
        <p className="mt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">No approved templates</p>
        <p className="mt-1 text-xs text-neutral-400">Submit templates in the Templates module and wait for Meta approval.</p>
      </div>
    );
  }

  function selectTemplate(t: WaTemplate) {
    const varCount = extractBodyVars(t);
    onChange((f) => ({
      ...f,
      templateId:     t.id,
      templateName:   t.name,
      variableValues: Array.from({ length: varCount }, () => ''),
    }));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">{templates.length} approved template{templates.length !== 1 ? 's' : ''} available</p>
      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTemplate(t)}
            className={cn(
              'w-full rounded-lg border p-3 text-left transition-colors',
              form.templateId === t.id
                ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20'
                : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className={cn(
                'text-sm font-medium truncate',
                form.templateId === t.id ? 'text-primary-700 dark:text-primary-300' : 'text-neutral-900 dark:text-neutral-100',
              )}>
                {t.name}
              </p>
              <Badge variant="default" className="text-[10px] shrink-0">{t.category}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-neutral-400">{t.templateName} · {t.language}</p>
          </button>
        ))}
      </div>

      {selectedTemplate && extractBodyVars(selectedTemplate) > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
          <p className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">Variable Mapping</p>
          <div className="space-y-2">
            {Array.from({ length: extractBodyVars(selectedTemplate) }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-neutral-400">{'{{' + (i + 1) + '}}'}</span>
                <select
                  value={form.variableValues[i] ?? ''}
                  onChange={(e) => {
                    const vv = [...form.variableValues];
                    vv[i] = e.target.value;
                    onChange((f) => ({ ...f, variableValues: vv }));
                  }}
                  className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  <option value="">— static value —</option>
                  <option value="{{name}}">Contact name</option>
                  <option value="{{phone}}">Contact phone</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Schedule ───────────────────────────────────────────────────────

function StepSchedule({
  form, onChange,
}: { form: CampaignFormData; onChange: React.Dispatch<React.SetStateAction<CampaignFormData>> }) {
  const options: Array<{ value: ScheduleMode; label: string; desc: string }> = [
    { value: 'now',       label: 'Send Now',      desc: 'Launch immediately after review'    },
    { value: 'scheduled', label: 'Schedule',      desc: 'Pick a date and time for delivery'  },
    { value: 'draft',     label: 'Save as Draft', desc: 'Launch manually from the dashboard' },
  ];

  return (
    <div className="space-y-3">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange((f) => ({ ...f, scheduleMode: opt.value }))}
          className={cn(
            'w-full rounded-lg border p-4 text-left transition-colors',
            form.scheduleMode === opt.value
              ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20'
              : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800',
          )}
        >
          <p className={cn('text-sm font-medium', form.scheduleMode === opt.value ? 'text-primary-700 dark:text-primary-300' : 'text-neutral-900 dark:text-neutral-100')}>
            {opt.label}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">{opt.desc}</p>
        </button>
      ))}

      {form.scheduleMode === 'scheduled' && (
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">Send at</label>
          <input
            type="datetime-local"
            value={form.scheduledAt}
            min={new Date().toISOString().slice(0, 16)}
            onChange={(e) => onChange((f) => ({ ...f, scheduledAt: e.target.value }))}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:[color-scheme:dark]"
          />
        </div>
      )}
    </div>
  );
}

// ── Step 5: Review ────────────────────────────────────────────────────────

function buildAudienceSummary(filter: AudienceFilter): string {
  const parts: string[] = [];
  if (filter.stages?.length)  parts.push(`${filter.stages.length} stage${filter.stages.length !== 1 ? 's' : ''}`);
  if (filter.tags?.length)    parts.push(`${filter.tags.length} tag${filter.tags.length !== 1 ? 's' : ''}`);
  if (filter.source)          parts.push(`source: ${filter.source}`);
  if (filter.assignedTo)      parts.push('assigned filter');
  return parts.length ? parts.join(' · ') : 'All contacts';
}

function StepReview({
  form, selectedTemplate, audienceData, audienceLoading,
}: {
  form:             CampaignFormData;
  selectedTemplate: WaTemplate | null;
  audienceData:     AudiencePreviewResponse | undefined;
  audienceLoading:  boolean;
}) {
  const rows = [
    { label: 'Name',      value: form.name },
    { label: 'Type',      value: form.type === 'whatsapp_broadcast' ? 'WhatsApp Broadcast' : 'Click-to-WhatsApp' },
    { label: 'Objective', value: form.objective.charAt(0).toUpperCase() + form.objective.slice(1) },
    { label: 'Audience',  value: buildAudienceSummary(form.filter) },
    { label: 'Template',  value: selectedTemplate ? selectedTemplate.name : form.type === 'ctwa' ? 'Configured in Meta Ads' : 'Not selected' },
    { label: 'Schedule',  value: form.scheduleMode === 'now' ? 'Send Now' : form.scheduleMode === 'scheduled' ? `Scheduled: ${new Date(form.scheduledAt).toLocaleString()}` : 'Save as Draft' },
  ];

  return (
    <div className="space-y-4">
      {/* Campaign summary */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        {rows.map((row, i) => (
          <div key={row.label} className={cn('flex gap-4 px-4 py-3', i < rows.length - 1 && 'border-b border-neutral-100 dark:border-neutral-800')}>
            <p className="w-20 shrink-0 text-xs font-medium text-neutral-400 pt-0.5">{row.label}</p>
            <p className="flex-1 text-sm text-neutral-900 dark:text-neutral-100 break-words">{row.value}</p>
          </div>
        ))}
      </div>

      {/* Live recipients — fresh fetch, staleTime:0 */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 uppercase tracking-wide">Live Recipients</p>
          {audienceLoading
            ? <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
            : <span className={cn('text-sm font-bold', audienceData?.exceedsLimit ? 'text-error-600 dark:text-error-400' : 'text-primary-700 dark:text-primary-300')}>
                {audienceData?.count ?? '—'}
              </span>
          }
        </div>

        {!audienceLoading && audienceData && ((audienceData.duplicatesRemoved ?? 0) > 0 || (audienceData.invalidPhoneCount ?? 0) > 0) && (
          <div className="flex flex-wrap gap-3 px-4 py-2 border-b border-neutral-100 dark:border-neutral-800 text-xs">
            {(audienceData.duplicatesRemoved ?? 0) > 0 && (
              <span className="text-warning-600 dark:text-warning-400">{audienceData.duplicatesRemoved} duplicate{audienceData.duplicatesRemoved !== 1 ? 's' : ''} removed</span>
            )}
            {(audienceData.invalidPhoneCount ?? 0) > 0 && (
              <span className="text-error-600 dark:text-error-400">{audienceData.invalidPhoneCount} invalid phone{audienceData.invalidPhoneCount !== 1 ? 's' : ''} skipped</span>
            )}
          </div>
        )}

        {audienceLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-neutral-400" /></div>
        ) : audienceData?.exceedsLimit ? (
          <p className="px-4 py-3 text-xs text-error-700 dark:text-error-400">Audience exceeds 1,000 contacts. Refine filters before launching.</p>
        ) : audienceData?.count === 0 ? (
          <p className="px-4 py-4 text-sm text-neutral-400 text-center">No contacts match the selected filters</p>
        ) : audienceData?.recipients ? (
          <div className="max-h-44 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
            {audienceData.recipients.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.name}</p>
                  <p className="text-xs text-neutral-400">{r.phone}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-neutral-500">{STAGE_LABELS[r.stage as Stage] ?? r.stage}</p>
                  {r.tags.length > 0 && (
                    <p className="text-xs text-neutral-400 max-w-[100px] truncate">{r.tags.slice(0, 2).join(', ')}{r.tags.length > 2 ? ` +${r.tags.length - 2}` : ''}</p>
                  )}
                </div>
              </div>
            ))}
            {audienceData.recipientsCapped && (
              <p className="px-4 py-2 text-xs text-neutral-400 text-center border-t border-neutral-100 dark:border-neutral-800">
                Showing first 50 of {audienceData.count} recipients
              </p>
            )}
          </div>
        ) : audienceData?.recipientsCapped ? (
          <p className="px-4 py-4 text-sm text-neutral-500 text-center">
            {audienceData.count.toLocaleString()} recipients — list omitted for large audiences
          </p>
        ) : null}
      </div>

      {form.scheduleMode === 'now' && form.type === 'whatsapp_broadcast' && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 dark:border-warning-800 dark:bg-warning-900/20">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" />
          <p className="text-xs text-warning-700 dark:text-warning-400">
            Clicking <strong>Launch Now</strong> will validate the current audience and send immediately if the count matches your review.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Campaign Ready view (validation passed) ───────────────────────────────

function CampaignReadyView({
  form, validation, isLaunching, onLaunch, onCancel,
}: {
  form:       CampaignFormData;
  validation: ValidateAudienceResponse;
  isLaunching: boolean;
  onLaunch:   () => void;
  onCancel:   () => void;
}) {
  const verifiedAt = new Date(validation.validatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const stats = [
    { label: 'Recipients',        value: validation.currentCount,            color: 'text-primary-700 dark:text-primary-300' },
    { label: 'Duplicates Removed', value: validation.stats.duplicatesRemoved, color: 'text-neutral-700 dark:text-neutral-300' },
    { label: 'Invalid Phones',     value: validation.stats.invalidPhoneCount, color: 'text-neutral-700 dark:text-neutral-300' },
  ];

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-100 dark:bg-success-900/30">
        <ShieldCheck className="h-7 w-7 text-success-600 dark:text-success-400" />
      </div>

      <div className="text-center">
        <p className="text-base font-semibold text-neutral-900 dark:text-white">Audience verified</p>
        <p className="mt-1 text-xs text-neutral-500">Verified at {verifiedAt} — matches your review exactly</p>
      </div>

      <div className="w-full grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-neutral-200 p-3 text-center dark:border-neutral-700">
            <p className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800">
        {[
          { label: 'Campaign',  value: form.name },
          { label: 'Schedule',  value: 'Send Now' },
        ].map((row) => (
          <div key={row.label} className="flex gap-4 px-4 py-2.5">
            <p className="w-20 shrink-0 text-xs font-medium text-neutral-400">{row.label}</p>
            <p className="flex-1 text-sm text-neutral-900 dark:text-neutral-100">{row.value}</p>
          </div>
        ))}
      </div>

      <div className="w-full flex flex-col gap-2">
        <Button
          variant="primary"
          className="w-full"
          loading={isLaunching}
          disabled={isLaunching}
          iconLeft={<Send className="h-4 w-4" />}
          onClick={onLaunch}
        >
          Launch Campaign — {validation.currentCount} recipients
        </Button>
        <Button variant="secondary" className="w-full" disabled={isLaunching} onClick={onCancel}>
          Back to Review
        </Button>
      </div>
    </div>
  );
}

// ── Audience Changed view (validation failed) ─────────────────────────────

function AudienceChangedView({
  validation, onRefresh, onCancel,
}: {
  validation: ValidateAudienceResponse;
  onRefresh:  () => void;
  onCancel:   () => void;
}) {
  const [showChanges, setShowChanges] = useState(false);
  const delta = validation.delta; // negative = fewer, positive = more
  const hasDetailedDiff = (validation.removed?.length ?? 0) + (validation.added?.length ?? 0) > 0;

  const reasons: string[] = [];
  if (validation.stats.duplicatesRemoved > 0)
    reasons.push(`${validation.stats.duplicatesRemoved} duplicate phone${validation.stats.duplicatesRemoved !== 1 ? 's' : ''} removed`);
  if (validation.stats.invalidPhoneCount > 0)
    reasons.push(`${validation.stats.invalidPhoneCount} invalid phone${validation.stats.invalidPhoneCount !== 1 ? 's' : ''} skipped`);
  if (Math.abs(delta) > validation.stats.duplicatesRemoved + validation.stats.invalidPhoneCount)
    reasons.push('leads deleted or stage changed since your review');

  return (
    <div className="flex flex-col gap-5 py-2">
      {/* Header */}
      <div className="flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-4 dark:border-warning-800 dark:bg-warning-900/20">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400" />
        <div>
          <p className="text-sm font-semibold text-warning-800 dark:text-warning-300">Audience has changed</p>
          <p className="mt-1 text-xs text-warning-700 dark:text-warning-400">
            APForce detected a difference between your review and the current audience.
            No messages have been sent.
          </p>
        </div>
      </div>

      {/* Count comparison */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Review Count',     value: validation.reviewCount,  color: 'text-neutral-800 dark:text-neutral-200' },
          { label: 'Current Eligible', value: validation.currentCount, color: 'text-primary-700 dark:text-primary-300' },
          { label: 'Difference',       value: `${delta > 0 ? '+' : ''}${delta}`, color: delta < 0 ? 'text-error-600 dark:text-error-400' : 'text-success-600 dark:text-success-400' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-neutral-200 p-3 text-center dark:border-neutral-700">
            <p className={cn('text-xl font-bold tabular-nums', s.color)}>{s.value}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Reasons */}
      {reasons.length > 0 && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <p className="px-4 py-2.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide border-b border-neutral-100 dark:border-neutral-800">
            Reasons
          </p>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {reasons.map((r) => (
              <div key={r} className="flex items-center gap-2 px-4 py-2.5">
                <XCircle className="h-3.5 w-3.5 shrink-0 text-error-500" />
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{r}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View Changes */}
      {hasDetailedDiff && (
        <div>
          <button
            type="button"
            onClick={() => setShowChanges((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            {showChanges ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showChanges ? 'Hide Changes' : 'View Changes'}
          </button>

          {showChanges && (
            <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Phone</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Stage</th>
                      <th className="px-3 py-2 text-left font-semibold text-neutral-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {validation.removed?.map((r, i) => (
                      <tr key={`rm-${i}`} className="bg-error-50/50 dark:bg-error-900/10">
                        <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-error-600 dark:text-error-400 font-medium"><XCircle className="h-3 w-3" />Removed</span></td>
                        <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300 max-w-[100px] truncate">{r.name}</td>
                        <td className="px-3 py-2 text-neutral-500 font-mono">{r.phone}</td>
                        <td className="px-3 py-2 text-neutral-500">{STAGE_LABELS[r.stage as Stage] ?? r.stage}</td>
                        <td className="px-3 py-2 text-neutral-500 max-w-[120px] truncate">{r.reason}</td>
                      </tr>
                    ))}
                    {validation.added?.map((r, i) => (
                      <tr key={`add-${i}`} className="bg-success-50/50 dark:bg-success-900/10">
                        <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-success-600 dark:text-success-400 font-medium"><ArrowRight className="h-3 w-3" />Added</span></td>
                        <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300 max-w-[100px] truncate">{r.name}</td>
                        <td className="px-3 py-2 text-neutral-500 font-mono">{r.phone}</td>
                        <td className="px-3 py-2 text-neutral-500">{STAGE_LABELS[r.stage as Stage] ?? r.stage}</td>
                        <td className="px-3 py-2 text-neutral-500 max-w-[120px] truncate">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          variant="primary"
          className="w-full"
          iconLeft={<RefreshCw className="h-4 w-4" />}
          onClick={onRefresh}
        >
          Refresh &amp; Review Again
        </Button>
        <Button variant="secondary" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
