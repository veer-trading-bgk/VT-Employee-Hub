'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Plus,
  Trash2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
  X,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Drawer } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Input } from '@/components/v3/ui/Input';
import { Select } from '@/components/v3/ui/Select';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { WhatsAppPreview } from './WhatsAppPreview';
import { validateTemplate } from '@/lib/templates/validation';
import { createTemplate, updateTemplate, templateKeys } from '@/lib/templates/api';
import { MediaSourceField } from '@/components/automation/MediaSourceField';
import type { TemplateFormValues, WaTemplate, TemplateCategory, ButtonType, OtpType, AiTemplateDraft } from '@/lib/templates/types';
import {
  CATEGORY_OPTIONS,
  LANGUAGE_OPTIONS,
  HEADER_FORMAT_OPTIONS,
  STANDARD_BUTTON_OPTIONS,
  BUTTON_TYPE_LABELS,
  LIMITS,
} from '@/lib/templates/constants';

// ── Default form state ────────────────────────────────────────────────────────

function defaultForm(): TemplateFormValues {
  return {
    name: '',
    templateName: '',
    category: 'UTILITY',
    language: 'en',
    allowCategoryChange: true,
    headerType: 'NONE',
    headerText: '',
    headerMediaRef: null,
    headerPreviewUrl: null,
    headerVariableExample: '',
    bodyText: '',
    bodyVariables: [],
    footerEnabled: false,
    footerText: '',
    buttonsEnabled: false,
    buttons: [],
    addSecurityRecommendation: false,
    codeExpirationMinutes: 10,
  };
}

function defaultButton(type: ButtonType = 'QUICK_REPLY'): TemplateFormValues['buttons'][0] {
  return {
    type,
    text: '',
    url: '',
    isDynamicUrl: false,
    dynamicUrlExample: '',
    phoneNumber: '',
    otpType: 'COPY_CODE',
    autofillText: 'Autofill OTP',
    packageName: '',
    signatureHash: '',
    flowId: '',
    flowAction: 'navigate',
    navigateScreen: '',
  };
}

// Resolves a presigned GET URL for the WhatsApp-bubble preview only — reuses
// the same GET /api/whatsapp/s3-url route the Inbox/Documents tab already
// use for exactly this purpose (ConversationTab.tsx, DocumentsTab.tsx).
// Cosmetic: a failed resolve just leaves the placeholder icon showing
// instead of the real image, never blocks saving/submitting the template.
async function resolveHeaderPreviewUrl(s3Key: string): Promise<string | null> {
  try {
    const res = await apiFetch<{ url: string }>(`/api/whatsapp/s3-url?key=${encodeURIComponent(s3Key)}`);
    return res.url;
  } catch {
    return null;
  }
}

// Auto-generate snake_case template name from display name
function toTemplateName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

// Maps an AI draft (POST /api/whatsapp/templates/ai-draft) onto the same
// TemplateFormValues shape a human-typed form produces — the draft is never a
// separate code path from here on; it goes through the exact same
// validateTemplate()/formToComponents()/Save Draft/Submit flow as anything
// else in this drawer. categoryReasoning is deliberately NOT part of
// TemplateFormValues — it's a UI-only aid for the admin, never persisted.
function applyAiDraft(draft: AiTemplateDraft): TemplateFormValues {
  return {
    ...defaultForm(),
    name: draft.name,
    templateName: toTemplateName(draft.name),
    category: draft.category,
    bodyText: draft.bodyText,
    bodyVariables: draft.bodyVariables,
    headerType: draft.headerText ? 'TEXT' : 'NONE',
    headerText: draft.headerText ?? '',
    footerEnabled: Boolean(draft.footerText),
    footerText: draft.footerText ?? '',
    buttonsEnabled: Boolean(draft.buttons?.length),
    buttons: (draft.buttons ?? []).map((b) => ({
      ...defaultButton(b.type),
      text: b.text,
      url: b.url ?? '',
      phoneNumber: b.phoneNumber ?? '',
    })),
  };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  editTemplate?: WaTemplate;
  aiDraft?: AiTemplateDraft;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TemplateCreateDrawer({ open, onClose, editTemplate, aiDraft }: Props) {
  const qc = useQueryClient();
  const isEdit = Boolean(editTemplate);

  const [form, setForm] = useState<TemplateFormValues>(defaultForm);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiBannerDismissed, setAiBannerDismissed] = useState(false);

  // Load editTemplate into form
  useEffect(() => {
    if (!open) { return; }
    if (editTemplate) {
      // Reconstruct form from template components
      const bodyComp = editTemplate.components?.find((c) => c.type === 'BODY');
      const headerComp = editTemplate.components?.find((c) => c.type === 'HEADER');
      const footerComp = editTemplate.components?.find((c) => c.type === 'FOOTER');
      const buttonsComp = editTemplate.components?.find((c) => c.type === 'BUTTONS');

      const bodyVarCount = editTemplate.variables?.length ?? 0;
      const bodyVars = Array.from({ length: bodyVarCount }, (_, i) => ({
        example: bodyComp?.example?.body_text?.[0]?.[i] ?? '',
        description: editTemplate.variables?.[i] ?? `Variable ${i + 1}`,
      }));

      const buttons = (buttonsComp?.buttons ?? []).map((b) => ({
        ...defaultButton(b.type as ButtonType),
        text: b.text ?? '',
        url: b.url ?? '',
        phoneNumber: b.phone_number ?? '',
        otpType: (b.otp_type ?? 'COPY_CODE') as OtpType,
        autofillText: b.autofill_text ?? 'Autofill OTP',
        packageName: b.package_name ?? '',
        signatureHash: b.signature_hash ?? '',
        isDynamicUrl: Boolean(b.url && b.url.includes('{{1}}')),
        dynamicUrlExample: b.example?.[0] ?? '',
      }));

      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: editTemplate.name,
        templateName: editTemplate.templateName,
        category: editTemplate.category,
        language: editTemplate.language,
        allowCategoryChange: editTemplate.allowCategoryChange ?? true,
        headerType: (headerComp?.format ?? 'NONE') as TemplateFormValues['headerType'],
        headerText: headerComp?.text ?? '',
        // The pre-fix broken shape (a raw URL under example.header_handle,
        // e.g. the one real draft that surfaced this whole bug) has no
        // headerMediaRef at all — falls through to null here, same as a
        // template with no media header. Recreating via this new upload UI
        // is the fix for that one record, not a migration (see
        // docs/phase3/TECHNICAL_DEBT.md).
        headerMediaRef: editTemplate.headerMediaRef ?? null,
        headerPreviewUrl: null, // resolved async below once headerMediaRef.s3Key is known
        headerVariableExample: headerComp?.example?.header_text?.[0] ?? '',
        bodyText: bodyComp?.text ?? editTemplate.bodyPreview ?? '',
        bodyVariables: bodyVars,
        footerEnabled: Boolean(footerComp),
        footerText: footerComp?.text ?? '',
        buttonsEnabled: buttons.length > 0,
        buttons,
        addSecurityRecommendation: Boolean(bodyComp?.add_security_recommendation),
        codeExpirationMinutes: footerComp?.code_expiration_minutes ?? 10,
      });
      setNameManuallyEdited(true);
      setAiReasoning(null);

      if (editTemplate.headerMediaRef?.s3Key) {
        const s3Key = editTemplate.headerMediaRef.s3Key;
        resolveHeaderPreviewUrl(s3Key).then((url) => {
          setForm((f) => (f.headerMediaRef?.s3Key === s3Key ? { ...f, headerPreviewUrl: url } : f));
        });
      }
    } else if (aiDraft) {
      setForm(applyAiDraft(aiDraft));
      setNameManuallyEdited(false);
      setAiReasoning(aiDraft.categoryReasoning);
      setAiBannerDismissed(false);
    } else {
      setForm(defaultForm());
      setNameManuallyEdited(false);
      setAiReasoning(null);
    }
    setSubmitted(false);
  }, [open, editTemplate, aiDraft]);

  // Re-sync body variables count when body text changes
  useEffect(() => {
    const matches = [...form.bodyText.matchAll(/\{\{(\d+)\}\}/g)];
    if (matches.length === 0) {
      if (form.bodyVariables.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm((f) => ({ ...f, bodyVariables: [] }));
      }
      return;
    }
    const maxN = Math.max(...matches.map((m) => parseInt(m[1])));
    const needed = isNaN(maxN) ? 0 : maxN;
    if (needed !== form.bodyVariables.length) {
      setForm((f) => ({
        ...f,
        bodyVariables: Array.from({ length: needed }, (_, i) => ({
          example: f.bodyVariables[i]?.example ?? '',
          description: f.bodyVariables[i]?.description ?? '',
        })),
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.bodyText]);

  const update = useCallback(<K extends keyof TemplateFormValues>(
    key: K,
    value: TemplateFormValues[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  function handleNameChange(displayName: string) {
    update('name', displayName);
    if (!nameManuallyEdited) {
      update('templateName', toTemplateName(displayName));
    }
  }

  function handleTemplateNameChange(v: string) {
    setNameManuallyEdited(true);
    update('templateName', v.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  }

  function addButton() {
    if (form.buttons.length >= LIMITS.BUTTONS_MAX) return;
    const isAuth = form.category === 'AUTHENTICATION';
    update('buttons', [...form.buttons, defaultButton(isAuth ? 'OTP' : 'QUICK_REPLY')]);
    update('buttonsEnabled', true);
  }

  function removeButton(i: number) {
    const next = form.buttons.filter((_, idx) => idx !== i);
    update('buttons', next);
    if (next.length === 0) update('buttonsEnabled', false);
  }

  function updateButton(i: number, field: string, value: unknown) {
    const next = form.buttons.map((b, idx) =>
      idx === i ? { ...b, [field]: value } : b,
    );
    update('buttons', next);
  }

  // Run validation for display (only show errors after submit attempt)
  const validation = validateTemplate(form);
  const showErrors = submitted;

  const visibleErrors = showErrors ? validation.errors : [];
  const visibleWarnings = validation.warnings;

  const createMutation = useMutation({
    mutationFn: () => isEdit
      ? updateTemplate(editTemplate!.id, form)
      : createTemplate(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      toast.success(isEdit ? 'Template updated' : 'Template saved as draft');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to save template'),
  });

  function handleSubmit() {
    setSubmitted(true);
    if (!validation.valid) {
      toast.error(`Fix ${validation.errors.length} error${validation.errors.length > 1 ? 's' : ''} before saving`);
      return;
    }
    createMutation.mutate();
  }

  const isAuth = form.category === 'AUTHENTICATION';
  const charCount = form.bodyText.length;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Template' : 'Create Template'}
      description={isEdit ? 'Update template content' : 'Build a new WhatsApp message template'}
      width={previewVisible ? 760 : 480}
      confirmClose={createMutation.isPending}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPreviewVisible((v) => !v)}
          >
            {previewVisible ? 'Hide Preview' : 'Show Preview'}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={createMutation.isPending}
              onClick={handleSubmit}
              disabled={showErrors && !validation.valid}
            >
              {isEdit ? 'Save Changes' : 'Save Draft'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex h-full gap-4 overflow-hidden">
        {/* ── Form column ───────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-5 p-4">

            {/* AI draft reasoning banner — dismissible, never re-shown once dismissed
                for this draft. The honesty-constraint line is fixed text, not
                AI-generated, so it can never be dropped or reworded by a model. */}
            {aiReasoning && !aiBannerDismissed && (
              <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 dark:border-primary-900/40 dark:bg-primary-900/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                        Why {form.category === 'MARKETING' ? 'Marketing' : 'Utility'}?
                      </p>
                      <p className="mt-0.5 text-xs text-primary-700/90 dark:text-primary-300/90">{aiReasoning}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAiBannerDismissed(true)}
                    aria-label="Dismiss"
                    className="shrink-0 text-primary-400 hover:text-primary-600 dark:hover:text-primary-300"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-primary-600/80 dark:text-primary-400/70">
                  AI drafts follow Meta&rsquo;s known template rules to maximize approval odds. Meta&rsquo;s review process is outside APForce&rsquo;s control and approval is never guaranteed.
                </p>
              </div>
            )}

            {/* Validation summary */}
            {showErrors && validation.errors.length > 0 && (
              <div className="rounded-lg border border-error-200 bg-error-50 p-3 dark:border-error-900/40 dark:bg-error-900/10">
                <div className="flex items-center gap-2 text-sm font-semibold text-error-700 dark:text-error-400">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                  {validation.errors.length} error{validation.errors.length > 1 ? 's' : ''} to fix
                </div>
                <ul className="mt-2 space-y-0.5">
                  {validation.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="text-xs text-error-600 dark:text-error-400">• {e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {visibleWarnings.length > 0 && (
              <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-900/40 dark:bg-warning-900/10">
                <div className="flex items-center gap-2 text-xs font-semibold text-warning-700 dark:text-warning-400">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {visibleWarnings.length} advisory notice{visibleWarnings.length > 1 ? 's' : ''}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {visibleWarnings.slice(0, 3).map((w, i) => (
                    <li key={i} className="text-xs text-warning-600 dark:text-warning-400">• {w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Section: Basic Info ──────────────────────────────────── */}
            <Section title="Basic Info">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Input
                    label="Display Name"
                    required
                    placeholder="e.g. Order Shipped"
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    error={fieldError(visibleErrors, 'name')}
                    hint="Internal name shown in APForce"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    label="Template Name (Meta)"
                    required
                    placeholder="order_shipped"
                    value={form.templateName}
                    onChange={(e) => handleTemplateNameChange(e.target.value)}
                    error={fieldError(visibleErrors, 'templateName')}
                    hint="Snake_case only · used by Meta API"
                  />
                </div>
                <Select
                  label="Category"
                  required
                  options={CATEGORY_OPTIONS}
                  value={form.category}
                  onChange={(e) => update('category', e.target.value as TemplateCategory)}
                  error={fieldError(visibleErrors, 'category')}
                />
                <Select
                  label="Language"
                  required
                  options={LANGUAGE_OPTIONS}
                  value={form.language}
                  onChange={(e) => update('language', e.target.value)}
                  error={fieldError(visibleErrors, 'language')}
                />
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-primary-600"
                  checked={form.allowCategoryChange}
                  onChange={(e) => update('allowCategoryChange', e.target.checked)}
                />
                <span className="text-xs text-neutral-600 dark:text-neutral-400">
                  Allow Meta to auto-assign correct category
                  <span className="ml-1 text-neutral-400">(recommended — avoids rejection)</span>
                </span>
              </label>
            </Section>

            {/* ── Section: Header ──────────────────────────────────────── */}
            {!isAuth && (
              <Section title="Header" optional>
                <Select
                  label="Header Type"
                  options={HEADER_FORMAT_OPTIONS}
                  value={form.headerType}
                  onChange={(e) => update('headerType', e.target.value as TemplateFormValues['headerType'])}
                />
                {form.headerType === 'TEXT' && (
                  <>
                    <Input
                      label="Header Text"
                      placeholder="Welcome to APForce"
                      value={form.headerText}
                      onChange={(e) => update('headerText', e.target.value)}
                      error={fieldError(visibleErrors, 'headerText')}
                      hint={`${form.headerText.length} / ${LIMITS.HEADER_TEXT_MAX} chars · 1 variable allowed`}
                    />
                    {form.headerText.includes('{{1}}') && (
                      <Input
                        label="Header Variable Example"
                        placeholder="e.g. John"
                        value={form.headerVariableExample}
                        onChange={(e) => update('headerVariableExample', e.target.value)}
                        hint="Example value for {{1}} in the header — required by Meta"
                      />
                    )}
                  </>
                )}
                {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType) && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-200">
                      Example {form.headerType === 'IMAGE' ? 'Image' : form.headerType === 'VIDEO' ? 'Video' : 'Document'}
                    </label>
                    <MediaSourceField
                      allowUrlMode={false}
                      accept={form.headerType === 'IMAGE' ? 'image/*' : form.headerType === 'VIDEO' ? 'video/*' : 'application/pdf'}
                      value={{
                        s3Key: form.headerMediaRef?.s3Key,
                        mimeType: form.headerMediaRef?.mimeType,
                        filename: form.headerMediaRef?.filename,
                      }}
                      onChange={(v) => {
                        if (!v.s3Key) {
                          update('headerMediaRef', null);
                          update('headerPreviewUrl', null);
                          return;
                        }
                        update('headerMediaRef', { s3Key: v.s3Key, mimeType: v.mimeType, filename: v.filename });
                        update('headerPreviewUrl', null); // clear the old preview immediately, resolve the new one below
                        resolveHeaderPreviewUrl(v.s3Key).then((url) => {
                          setForm((f) => (f.headerMediaRef?.s3Key === v.s3Key ? { ...f, headerPreviewUrl: url } : f));
                        });
                      }}
                    />
                    {fieldError(visibleErrors, 'headerMediaRef') ? (
                      <p className="mt-1 text-xs text-error-600">{fieldError(visibleErrors, 'headerMediaRef')}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-neutral-400">
                        Meta requires a real example to review this template — it&apos;s uploaded via Meta&apos;s own Resumable Upload API when you submit, not just used for preview.
                      </p>
                    )}
                  </div>
                )}
              </Section>
            )}

            {/* ── Section: Body ────────────────────────────────────────── */}
            {!isAuth && (
              <Section title="Body" required>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                    Message Body <span className="ml-0.5 text-error-600" aria-hidden>*</span>
                  </label>
                  <div className="relative">
                    <textarea
                      rows={5}
                      placeholder={`Hi {{1}}, your order {{2}} has been shipped!\n\nUse *bold*, _italic_, ~strike~ for formatting.`}
                      value={form.bodyText}
                      onChange={(e) => update('bodyText', e.target.value)}
                      className={cn(
                        'w-full resize-none rounded-lg border bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400',
                        'focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-primary-600',
                        'dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700 dark:placeholder:text-neutral-600',
                        fieldError(visibleErrors, 'bodyText')
                          ? 'border-error-500'
                          : 'border-neutral-200',
                      )}
                    />
                    <div className="absolute bottom-2 right-2.5 flex items-center gap-2">
                      {/* Quick variable insert buttons */}
                      <div className="flex gap-1">
                        {[1, 2, 3].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => update('bodyText', form.bodyText + `{{${n}}}`)}
                            className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                          >
                            +{`{{${n}}}`}
                          </button>
                        ))}
                      </div>
                      <span className={cn('text-[10px]', charCount > LIMITS.BODY_MAX ? 'text-error-600' : 'text-neutral-400')}>
                        {charCount} / {LIMITS.BODY_MAX}
                      </span>
                    </div>
                  </div>
                  {fieldError(visibleErrors, 'bodyText') && (
                    <p className="text-xs text-error-600">{fieldError(visibleErrors, 'bodyText')}</p>
                  )}
                </div>

                {/* Variable examples */}
                {form.bodyVariables.length > 0 && (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
                    <p className="mb-2 text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                      Variable Examples (required by Meta)
                    </p>
                    <div className="flex flex-col gap-2">
                      {form.bodyVariables.map((v, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <code className="w-10 shrink-0 rounded bg-neutral-200 px-1.5 py-1 text-center text-[10px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                            {`{{${i + 1}}}`}
                          </code>
                          <input
                            type="text"
                            placeholder={`Example for {{${i + 1}}}`}
                            value={v.example}
                            onChange={(e) => {
                              const next = form.bodyVariables.map((vv, j) =>
                                j === i ? { ...vv, example: e.target.value } : vv,
                              );
                              update('bodyVariables', next);
                            }}
                            className={cn(
                              'flex-1 rounded-lg border bg-white px-2.5 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400',
                              'focus:outline-none focus:ring-1 focus:ring-primary-600 focus:border-primary-600',
                              'dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-600 dark:placeholder:text-neutral-500',
                              fieldError(visibleErrors, `bodyVariables[${i}].example`)
                                ? 'border-error-500'
                                : 'border-neutral-200',
                            )}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            )}

            {/* ── Section: Authentication ──────────────────────────────── */}
            {isAuth && (
              <Section title="Authentication Settings">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Meta auto-generates the body text: &ldquo;Your verification code is <code>{'{{1}}'}</code>&rdquo;
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 accent-primary-600"
                    checked={form.addSecurityRecommendation}
                    onChange={(e) => update('addSecurityRecommendation', e.target.checked)}
                  />
                  <span className="text-xs text-neutral-700 dark:text-neutral-300">
                    Add security recommendation
                    <span className="ml-1 text-neutral-400">(&ldquo;For your security, do not share this code&rdquo;)</span>
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-200">
                      Code Expiry (minutes)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={form.codeExpirationMinutes || ''}
                      onChange={(e) => update('codeExpirationMinutes', parseInt(e.target.value) || 0)}
                      placeholder="10"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-600 dark:bg-neutral-900 dark:border-neutral-700 dark:text-white"
                    />
                    <p className="mt-1 text-xs text-neutral-400">1–90 mins · 0 to disable</p>
                  </div>
                </div>
              </Section>
            )}

            {/* ── Section: Footer ──────────────────────────────────────── */}
            {!isAuth && (
              <Section title="Footer" optional>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 accent-primary-600"
                    checked={form.footerEnabled}
                    onChange={(e) => update('footerEnabled', e.target.checked)}
                  />
                  <span className="text-sm text-neutral-700 dark:text-neutral-300">Add footer text</span>
                </label>
                {form.footerEnabled && (
                  <Input
                    label="Footer Text"
                    placeholder="APForce · Reply STOP to unsubscribe"
                    value={form.footerText}
                    onChange={(e) => update('footerText', e.target.value)}
                    error={fieldError(visibleErrors, 'footerText')}
                    hint={`${form.footerText.length} / ${LIMITS.FOOTER_MAX} chars · No variables allowed`}
                  />
                )}
              </Section>
            )}

            {/* ── Section: Buttons ─────────────────────────────────────── */}
            <Section
              title="Buttons"
              optional={!isAuth}
              required={isAuth}
              action={
                !isAuth && form.buttons.length < LIMITS.BUTTONS_MAX ? (
                  <button
                    type="button"
                    onClick={addButton}
                    className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add button
                  </button>
                ) : null
              }
            >
              {isAuth && form.buttons.length === 0 && (
                <Button variant="secondary" size="sm" onClick={addButton}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add OTP button
                </Button>
              )}

              {form.buttons.length === 0 && !isAuth && (
                <button
                  type="button"
                  onClick={addButton}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 py-3 text-sm text-neutral-500 hover:border-primary-400 hover:text-primary-600 dark:border-neutral-700 dark:hover:border-primary-600"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add up to {LIMITS.BUTTONS_MAX} buttons
                </button>
              )}

              {fieldError(visibleErrors, 'buttons') && (
                <p className="text-xs text-error-600">{fieldError(visibleErrors, 'buttons')}</p>
              )}

              <div className="flex flex-col gap-3">
                {form.buttons.map((btn, i) => (
                  <ButtonEditor
                    key={i}
                    index={i}
                    button={btn}
                    isAuth={isAuth}
                    onChange={(f, v) => updateButton(i, f, v)}
                    onRemove={() => removeButton(i)}
                    errors={visibleErrors}
                  />
                ))}
              </div>
            </Section>

          </div>
        </div>

        {/* ── Preview column ────────────────────────────────────────────── */}
        {previewVisible && (
          <div className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800 md:block">
            <WhatsAppPreview form={form} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({
  title,
  required,
  optional,
  action,
  children,
}: {
  title: string;
  required?: boolean;
  optional?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center px-3.5 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{title}</span>
            {optional && (
              <span className="text-[10px] font-medium text-neutral-400 bg-neutral-100 rounded-full px-1.5 py-0.5 dark:bg-neutral-800 dark:text-neutral-500">
                optional
              </span>
            )}
            {required && (
              <span className="text-error-600 text-xs" aria-hidden>*</span>
            )}
          </span>
          {open ? (
            <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
          ) : (
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
          )}
        </button>
        {action && <div className="ml-2 shrink-0">{action}</div>}
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-neutral-100 px-3.5 pb-3.5 pt-3 dark:border-neutral-800">
          {children}
        </div>
      )}
    </div>
  );
}

interface ButtonEditorProps {
  index: number;
  button: TemplateFormValues['buttons'][0];
  isAuth: boolean;
  onChange: (field: string, value: unknown) => void;
  onRemove: () => void;
  errors: import('@/lib/templates/types').ValidationIssue[];
}

function ButtonEditor({ index, button, isAuth, onChange, onRemove, errors }: ButtonEditorProps) {
  const prefix = `buttons[${index}]`;

  // Types like FLOW/MPM/CATALOG have no editor here — STANDARD_BUTTON_OPTIONS'
  // dropdown never offers them, so they can only reach an existing template via
  // another path (e.g. a /templates/sync pull from Meta). Rendering the normal
  // form would show a <Select> with a value that isn't one of its own options.
  // Read-only instead, so the button's real content stays visible without a
  // broken control (Templates module audit, finding #6).
  const isUnsupportedType = !isAuth && !STANDARD_BUTTON_OPTIONS.some((o) => o.value === button.type);

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          Button {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-neutral-400 hover:text-error-600"
          aria-label={`Remove button ${index + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {isUnsupportedType ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-2 dark:border-neutral-700 dark:bg-neutral-800">
            <span className="truncate text-sm text-neutral-800 dark:text-neutral-200">
              {button.text || <span className="italic text-neutral-400">(no text)</span>}
            </span>
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
              {BUTTON_TYPE_LABELS[button.type] ?? button.type}
            </span>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-neutral-400">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Not editable here — this button type isn&rsquo;t supported by the template editor yet. Remove it to add a supported button instead.
          </p>
        </div>
      ) : (
      <div className="flex flex-col gap-2.5">
        {/* Type selector */}
        {!isAuth && (
          <Select
            label="Button Type"
            options={STANDARD_BUTTON_OPTIONS}
            value={button.type}
            onChange={(e) => onChange('type', e.target.value)}
          />
        )}
        {isAuth && (
          <Select
            label="OTP Type"
            options={[
              { value: 'COPY_CODE', label: 'Copy Code (copies OTP to clipboard)' },
              { value: 'ONE_TAP', label: 'One-Tap Autofill (auto-fills in app)' },
              { value: 'ZERO_TAP', label: 'Zero-Tap Autofill (automatic, no user action)' },
            ]}
            value={button.otpType}
            onChange={(e) => onChange('otpType', e.target.value)}
          />
        )}

        {/* Button text */}
        <Input
          label="Button Text"
          placeholder={BUTTON_TYPE_LABELS[button.type] ?? 'Button text'}
          value={button.text}
          onChange={(e) => onChange('text', e.target.value)}
          error={fieldError(errors, `${prefix}.text`)}
          hint={`${button.text.length} / ${LIMITS.BUTTON_TEXT_MAX} chars`}
        />

        {/* URL fields */}
        {button.type === 'URL' && (
          <>
            <Input
              label="URL"
              placeholder="https://example.com/track"
              value={button.url}
              onChange={(e) => onChange('url', e.target.value)}
              error={fieldError(errors, `${prefix}.url`)}
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-neutral-300 accent-primary-600"
                checked={button.isDynamicUrl}
                onChange={(e) => onChange('isDynamicUrl', e.target.checked)}
              />
              <span className="text-xs text-neutral-600 dark:text-neutral-400">
                Dynamic URL (append variable at send time)
              </span>
            </label>
            {button.isDynamicUrl && (
              <Input
                label="URL Variable Example"
                placeholder="ORDER-12345"
                value={button.dynamicUrlExample}
                onChange={(e) => onChange('dynamicUrlExample', e.target.value)}
                error={fieldError(errors, `${prefix}.dynamicUrlExample`)}
                hint="Example value for the URL suffix variable"
              />
            )}
          </>
        )}

        {/* Phone fields */}
        {button.type === 'PHONE_NUMBER' && (
          <Input
            label="Phone Number"
            placeholder="+917200000000"
            value={button.phoneNumber}
            onChange={(e) => onChange('phoneNumber', e.target.value)}
            error={fieldError(errors, `${prefix}.phoneNumber`)}
            hint="E.164 format required: +[country code][number]"
          />
        )}

        {/* One-Tap / Zero-Tap OTP fields */}
        {isAuth && (button.otpType === 'ONE_TAP' || button.otpType === 'ZERO_TAP') && (
          <>
            <Input
              label="Autofill Button Text"
              placeholder="Autofill OTP"
              value={button.autofillText}
              onChange={(e) => onChange('autofillText', e.target.value)}
            />
            <Input
              label="Android Package Name"
              placeholder="com.example.app"
              value={button.packageName}
              onChange={(e) => onChange('packageName', e.target.value)}
              error={fieldError(errors, `${prefix}.packageName`)}
            />
            <Input
              label="App Signature Hash"
              placeholder="K8a%2FAINcGX7"
              value={button.signatureHash}
              onChange={(e) => onChange('signatureHash', e.target.value)}
              error={fieldError(errors, `${prefix}.signatureHash`)}
            />
          </>
        )}
      </div>
      )}
    </div>
  );
}

function fieldError(
  errors: import('@/lib/templates/types').ValidationIssue[],
  field: string,
): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}
