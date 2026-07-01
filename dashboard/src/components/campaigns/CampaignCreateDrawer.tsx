'use client';

import { useState, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Send, CalendarDays, FileText,
  CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Drawer } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { AudienceBuilder } from './AudienceBuilder';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import type {
  CampaignType, CampaignObjective, ScheduleMode,
  CampaignFormData, CampaignResponse, LaunchResponse, AudienceFilter,
} from '@/types/campaigns';

// ── Types ──────────────────────────────────────────────────────────────────

interface WaTemplate {
  id:            string;   // backend field (was incorrectly typed as templateId)
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
  const [step, setStep]               = useState(0);
  const [form, setForm]               = useState<CampaignFormData>(EMPTY_FORM);
  const [result, setResult]           = useState<LaunchResponse | null>(null);
  const qc = useQueryClient();

  // Only fetch templates when on step 2
  const { data: tmplData, isLoading: tmplLoading } = useQuery<WaTemplatesResponse>({
    queryKey: ['wa-templates'],
    queryFn:  () => apiFetch('/api/whatsapp/templates'),
    enabled:  open && step === 2,
    staleTime: 5 * 60 * 1000,
  });
  const approvedTemplates = (tmplData?.templates ?? []).filter((t) => t.status === 'APPROVED');
  const selectedTemplate  = approvedTemplates.find((t) => t.id === form.templateId) ?? null;

  function handleClose() {
    setStep(0);
    setForm(EMPTY_FORM);
    setResult(null);
    onClose();
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    qc.invalidateQueries({ queryKey: ['campaign-stats'] });
  }

  // Save as draft or scheduled
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
      invalidate();
      toast.success(status === 'draft' ? 'Campaign saved as draft' : 'Campaign scheduled');
      handleClose();
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to save'),
  });

  // Create then immediately launch
  const launchMutation = useMutation({
    mutationFn: async () => {
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
      return apiFetch<LaunchResponse>(`/api/campaigns/${created.campaign.id}/launch`, { method: 'POST' });
    },
    onSuccess: (r) => { invalidate(); setResult(r); },
    onError:   (err: Error) => toast.error(err.message ?? 'Launch failed'),
  });

  const canNext = useCallback(() => {
    if (step === 0) return form.name.trim().length > 0;
    if (step === 2) return form.type === 'ctwa' || (form.templateId?.length ?? 0) > 0;
    if (step === 3) return form.scheduleMode !== 'scheduled' || form.scheduledAt.length > 0;
    return true;
  }, [step, form]);

  const isLoading = saveMutation.isPending || launchMutation.isPending;

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
            <p className="mt-1 text-sm text-neutral-500">{result.total} contacts targeted</p>
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

  // ── Wizard ────────────────────────────────────────────────────────────────
  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Create Campaign"
      description={`Step ${step + 1} of ${STEP_LABELS.length} — ${STEP_LABELS[step]}`}
      width={520}
      confirmClose={form.name.length > 0}
      footer={
        <div className="flex items-center justify-between gap-2">
          {/* Step indicator */}
          <div className="flex gap-1.5">
            {STEP_LABELS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-1.5 w-6 rounded-full transition-colors',
                  i === step ? 'bg-primary-600' : i < step ? 'bg-primary-200' : 'bg-neutral-200 dark:bg-neutral-700',
                )}
              />
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
                <Button variant="secondary" size="sm" loading={saveMutation.isPending} disabled={isLoading}
                  onClick={() => saveMutation.mutate({ status: 'draft' })} type="button">
                  Save Draft
                </Button>
                {form.scheduleMode === 'now' && (
                  <Button variant="primary" size="sm" loading={launchMutation.isPending} disabled={isLoading}
                    iconLeft={<Send className="h-4 w-4" />} onClick={() => launchMutation.mutate()}>
                    Launch Now
                  </Button>
                )}
                {form.scheduleMode === 'scheduled' && (
                  <Button variant="primary" size="sm" loading={saveMutation.isPending}
                    disabled={isLoading || !form.scheduledAt}
                    iconLeft={<CalendarDays className="h-4 w-4" />}
                    onClick={() => saveMutation.mutate({ status: 'scheduled' })}>
                    Schedule
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      }
    >
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
      {step === 4 && <StepReview form={form} selectedTemplate={selectedTemplate} />}
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
            key={t.templateId}
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

      {/* Variable mapping */}
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

function StepReview({ form, selectedTemplate }: { form: CampaignFormData; selectedTemplate: WaTemplate | null }) {
  const rows = [
    { label: 'Name',     value: form.name },
    { label: 'Type',     value: form.type === 'whatsapp_broadcast' ? 'WhatsApp Broadcast' : 'Click-to-WhatsApp' },
    { label: 'Objective', value: form.objective.charAt(0).toUpperCase() + form.objective.slice(1) },
    { label: 'Audience', value: buildAudienceSummary(form.filter) },
    { label: 'Template', value: selectedTemplate ? selectedTemplate.name : form.type === 'ctwa' ? 'Configured in Meta Ads' : 'Not selected' },
    { label: 'Schedule', value: form.scheduleMode === 'now' ? 'Send Now' : form.scheduleMode === 'scheduled' ? `Scheduled: ${new Date(form.scheduledAt).toLocaleString()}` : 'Save as Draft' },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        {rows.map((row, i) => (
          <div key={row.label} className={cn('flex gap-4 px-4 py-3', i < rows.length - 1 && 'border-b border-neutral-100 dark:border-neutral-800')}>
            <p className="w-20 shrink-0 text-xs font-medium text-neutral-400 pt-0.5">{row.label}</p>
            <p className="flex-1 text-sm text-neutral-900 dark:text-neutral-100 break-words">{row.value}</p>
          </div>
        ))}
      </div>

      {form.scheduleMode === 'now' && form.type === 'whatsapp_broadcast' && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 dark:border-warning-800 dark:bg-warning-900/20">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" />
          <p className="text-xs text-warning-700 dark:text-warning-400">
            Messages will be sent immediately to all matched contacts. This action cannot be undone.
          </p>
        </div>
      )}
    </div>
  );
}
