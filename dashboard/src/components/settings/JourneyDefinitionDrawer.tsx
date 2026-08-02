'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Input } from '@/components/v3/ui/Input';
import { Select } from '@/components/v3/ui/Select';
import { Toggle } from '@/components/v3/ui/Toggle';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { uploadFileToS3 } from '@/lib/mediaUpload';
import {
  createJourneyDefinition,
  journeyKeys,
  updateJourneyDefinition,
} from '@/lib/journeys/api';
import type {
  JourneyBrandingConfig,
  JourneyDefinition,
  JourneyDefinitionFormValues,
  JourneyScreen,
  JourneyScreenField,
} from '@/lib/journeys/types';
import type { AutomationsResponse } from '@/types/automations';

const INDUSTRY_SUGGESTIONS = ['generic', 'healthcare', 'bfsi'] as const;
const DEFAULT_PRIMARY_COLOR = '#0ea5e9';
const BANNER_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BANNER_MAX_BYTES = 2 * 1024 * 1024;

function brandingFromDefinition(d: JourneyDefinition): JourneyBrandingConfig | null {
  const raw = d.brandingConfig;
  if (!raw || typeof raw !== 'object') return null;
  const primaryColor = typeof (raw as { primaryColor?: unknown }).primaryColor === 'string'
    ? (raw as { primaryColor: string }).primaryColor.trim()
    : '';
  const bannerImageUrl = typeof (raw as { bannerImageUrl?: unknown }).bannerImageUrl === 'string'
    ? (raw as { bannerImageUrl: string }).bannerImageUrl.trim()
    : '';
  if (!primaryColor && !bannerImageUrl) return null;
  return {
    ...(primaryColor ? { primaryColor } : {}),
    ...(bannerImageUrl ? { bannerImageUrl } : {}),
  };
}

/** Merge a branding patch; returns null when both fields are empty. */
function patchBranding(
  current: JourneyBrandingConfig | null,
  patch: Partial<JourneyBrandingConfig>,
): JourneyBrandingConfig | null {
  const merged = { ...(current ?? {}), ...patch };
  const primaryColor = merged.primaryColor?.trim() || '';
  const bannerImageUrl = merged.bannerImageUrl?.trim() || '';
  if (!primaryColor && !bannerImageUrl) return null;
  return {
    ...(primaryColor ? { primaryColor } : {}),
    ...(bannerImageUrl ? { bannerImageUrl } : {}),
  };
}

/**
 * Starter field types — Task 6 zod only enforces string; locked here from:
 * architecture "generic field primitives" (text, select, date/time) + forms.js
 * contact fields (name/phone/email). `number` added 2026-08-02 (Event Booking
 * ticket_quantity) — forms.js has no numeric convention to mirror; HTML
 * input type="number" matches the phone/date/email pattern. Only `select`
 * is choice-based → options[].
 */
const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'select', label: 'Select' },
  { value: 'phone', label: 'Phone' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'number', label: 'Number' },
] as const;

type JourneyFieldType = (typeof FIELD_TYPE_OPTIONS)[number]['value'];

function isChoiceType(type: string): type is 'select' {
  return type === 'select';
}

/** Same uniqueness approach as ManagePipelineDrawer addStage() in sales/page.tsx. */
function uniqueScopedId(prefix: string, existing: string[]): string {
  const set = new Set(existing);
  let id = prefix;
  let n = 2;
  while (set.has(id)) id = `${prefix}_${n++}`;
  return id;
}

function emptyForm(): JourneyDefinitionFormValues {
  return {
    name: '',
    industryPack: 'generic',
    linkedWorkflowId: null,
    active: true,
    screens: [],
    brandingConfig: null,
    gstEnabled: false,
    gstPercent: 18,
    gstMode: 'exclusive',
  };
}

function formFromDefinition(d: JourneyDefinition): JourneyDefinitionFormValues {
  return {
    name: d.name,
    industryPack: d.industryPack || 'generic',
    linkedWorkflowId: d.linkedWorkflowId ?? null,
    active: d.active !== false,
    screens: (d.screens ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      fields: (s.fields ?? []).map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        ...(f.required !== undefined ? { required: f.required } : {}),
        ...(isChoiceType(f.type) && f.options ? { options: [...f.options] } : {}),
        ...(f.type === 'number' && typeof f.unitPrice === 'number' ? { unitPrice: f.unitPrice } : {}),
      })),
    })),
    brandingConfig: brandingFromDefinition(d),
    gstEnabled: d.gstEnabled === true,
    gstPercent: typeof d.gstPercent === 'number' ? d.gstPercent : 18,
    gstMode: d.gstMode === 'inclusive' ? 'inclusive' : 'exclusive',
  };
}

/** Same gate as public grand total — GST UI only when ≥1 field has unitPrice. */
function definitionHasPricedField(screens: JourneyScreen[]): boolean {
  return screens.some((s) =>
    (s.fields ?? []).some((f) => typeof f.unitPrice === 'number'),
  );
}

/** Strip empty option strings; drop options on non-choice types before PUT/POST. */
function sanitizeScreens(screens: JourneyScreen[]): JourneyScreen[] {
  return screens.map((s) => ({
    id: s.id.trim(),
    title: s.title.trim(),
    fields: (s.fields ?? []).map((f) => {
      const field: JourneyScreenField = {
        id: f.id.trim(),
        label: f.label.trim(),
        type: f.type.trim() || 'text',
      };
      if (f.required) field.required = true;
      if (isChoiceType(field.type)) {
        const opts = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
        if (opts.length > 0) field.options = opts;
      }
      if (field.type === 'number' && typeof f.unitPrice === 'number' && f.unitPrice >= 0) {
        field.unitPrice = f.unitPrice;
      }
      return field;
    }),
  }));
}

function screensValid(screens: JourneyScreen[]): boolean {
  for (const s of screens) {
    if (!s.id.trim() || !s.title.trim()) return false;
    for (const f of s.fields ?? []) {
      if (!f.id.trim() || !f.label.trim() || !f.type.trim()) return false;
    }
  }
  return true;
}

const rowBtnCls =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 disabled:opacity-30 sm:h-7 sm:w-7 dark:hover:bg-neutral-800';
const rowInputCls =
  'min-w-0 flex-1 rounded-lg border border-neutral-200 bg-transparent px-2.5 py-1.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:text-neutral-100';
const selectCls =
  'rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';

export function JourneyDefinitionDrawer({
  open,
  onClose,
  definition,
}: {
  open: boolean;
  onClose: () => void;
  /** null = create; object = edit */
  definition: JourneyDefinition | null;
}) {
  const qc = useQueryClient();
  const isEdit = definition !== null;
  const [form, setForm] = useState<JourneyDefinitionFormValues>(emptyForm());
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(definition ? formFromDefinition(definition) : emptyForm());
  }, [open, definition]);

  // Reuse WorkflowList's existing list ownership — same queryKey + endpoint.
  const { data: automationsData } = useQuery<AutomationsResponse>({
    queryKey: ['automations'],
    queryFn: () => apiFetch('/api/automations'),
    staleTime: 60_000,
    enabled: open,
  });

  const workflowOptions = useMemo(() => {
    const options = [
      { value: '', label: 'None' },
      ...(automationsData?.automations ?? [])
        .filter((w) => w.status === 'active')
        .map((w) => ({ value: w.id, label: w.name || w.id })),
    ];
    if (
      form.linkedWorkflowId
      && !options.some((o) => o.value === form.linkedWorkflowId)
    ) {
      const orphan = automationsData?.automations?.find((w) => w.id === form.linkedWorkflowId);
      options.push({
        value: form.linkedWorkflowId,
        label: orphan
          ? `${orphan.name} (${orphan.status})`
          : `${form.linkedWorkflowId} (unavailable)`,
      });
    }
    return options;
  }, [automationsData, form.linkedWorkflowId]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: JourneyDefinitionFormValues = {
        ...form,
        screens: sanitizeScreens(form.screens),
      };
      if (isEdit && definition) {
        return updateJourneyDefinition(definition.id, payload);
      }
      return createJourneyDefinition(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journeyKeys.list() });
      toast.success(isEdit ? 'Journey definition updated' : 'Journey definition created');
      onClose();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'Failed to save journey definition')),
  });

  const canSubmit =
    form.name.trim().length > 0
    && screensValid(form.screens)
    && !saveMut.isPending
    && !uploadingBanner;

  const showGstSection = definitionHasPricedField(form.screens);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    saveMut.mutate();
  }

  async function handleBannerSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!BANNER_ALLOWED_MIME.has(file.type)) {
      toast.error('Only JPG, PNG, and WebP images are allowed');
      return;
    }
    if (file.size > BANNER_MAX_BYTES) {
      toast.error('Banner must be under 2MB');
      return;
    }
    setUploadingBanner(true);
    try {
      const { publicUrl } = await uploadFileToS3(file, undefined, '/api/journeys/banner-upload-url');
      if (!publicUrl) {
        throw new Error('Upload succeeded but no public URL was returned');
      }
      setForm((f) => ({
        ...f,
        brandingConfig: patchBranding(f.brandingConfig, { bannerImageUrl: publicUrl }),
      }));
      toast.success('Banner uploaded');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to upload banner'));
    } finally {
      setUploadingBanner(false);
    }
  }

  // ── Screen-level helpers (ManagePipelineDrawer move/add/remove pattern) ──

  function moveScreen(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= form.screens.length) return;
    setForm((f) => {
      const next = [...f.screens];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, screens: next };
    });
  }

  function removeScreen(i: number) {
    setForm((f) => ({ ...f, screens: f.screens.filter((_, idx) => idx !== i) }));
  }

  function addScreen() {
    setForm((f) => {
      const id = uniqueScopedId('screen', f.screens.map((s) => s.id));
      return {
        ...f,
        screens: [...f.screens, { id, title: 'New screen', fields: [] }],
      };
    });
  }

  function patchScreen(i: number, patch: Partial<JourneyScreen>) {
    setForm((f) => ({
      ...f,
      screens: f.screens.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  }

  function moveField(si: number, fi: number, dir: -1 | 1) {
    setForm((f) => {
      const screen = f.screens[si];
      if (!screen) return f;
      const j = fi + dir;
      if (j < 0 || j >= screen.fields.length) return f;
      const fields = [...screen.fields];
      [fields[fi], fields[j]] = [fields[j], fields[fi]];
      return {
        ...f,
        screens: f.screens.map((s, idx) => (idx === si ? { ...s, fields } : s)),
      };
    });
  }

  function removeField(si: number, fi: number) {
    setForm((f) => ({
      ...f,
      screens: f.screens.map((s, idx) => (
        idx === si ? { ...s, fields: s.fields.filter((_, j) => j !== fi) } : s
      )),
    }));
  }

  function addField(si: number) {
    setForm((f) => {
      const screen = f.screens[si];
      if (!screen) return f;
      const id = uniqueScopedId('field', screen.fields.map((x) => x.id));
      const field: JourneyScreenField = { id, label: 'New field', type: 'text' };
      return {
        ...f,
        screens: f.screens.map((s, idx) => (
          idx === si ? { ...s, fields: [...s.fields, field] } : s
        )),
      };
    });
  }

  function patchField(si: number, fi: number, patch: Partial<JourneyScreenField>) {
    setForm((f) => ({
      ...f,
      screens: f.screens.map((s, idx) => {
        if (idx !== si) return s;
        return {
          ...s,
          fields: s.fields.map((field, j) => {
            if (j !== fi) return field;
            const next: JourneyScreenField = { ...field, ...patch };
            if ('required' in patch && !patch.required) delete next.required;
            if (patch.type !== undefined && !isChoiceType(patch.type)) {
              delete next.options;
            }
            if (patch.type !== undefined && patch.type !== 'number') {
              delete next.unitPrice;
            }
            if (patch.type === 'select' && !next.options) {
              next.options = [''];
            }
            if ('unitPrice' in patch && patch.unitPrice === undefined) {
              delete next.unitPrice;
            }
            return next;
          }),
        };
      }),
    }));
  }

  function setFieldOption(si: number, fi: number, oi: number, value: string) {
    setForm((f) => ({
      ...f,
      screens: f.screens.map((s, idx) => {
        if (idx !== si) return s;
        return {
          ...s,
          fields: s.fields.map((field, j) => {
            if (j !== fi) return field;
            const options = [...(field.options ?? [])];
            options[oi] = value;
            return { ...field, options };
          }),
        };
      }),
    }));
  }

  function addFieldOption(si: number, fi: number) {
    setForm((f) => ({
      ...f,
      screens: f.screens.map((s, idx) => {
        if (idx !== si) return s;
        return {
          ...s,
          fields: s.fields.map((field, j) => (
            j === fi ? { ...field, options: [...(field.options ?? []), ''] } : field
          )),
        };
      }),
    }));
  }

  function removeFieldOption(si: number, fi: number, oi: number) {
    setForm((f) => ({
      ...f,
      screens: f.screens.map((s, idx) => {
        if (idx !== si) return s;
        return {
          ...s,
          fields: s.fields.map((field, j) => {
            if (j !== fi) return field;
            return { ...field, options: (field.options ?? []).filter((_, k) => k !== oi) };
          }),
        };
      }),
    }));
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit journey definition' : 'New journey definition'}
      description="Basics, branding, and ordered screens/fields."
      // Wide panel — same Drawer width= prop pattern as TemplateCreateDrawer
      // (760px with preview). Nested screens/fields need more room than the
      // default 420–520px Settings drawers; scoped here only.
      width={1000}
      footer={(
        <DrawerFooter>
          <Button variant="secondary" size="md" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="journey-def-form"
            loading={saveMut.isPending}
            disabled={!canSubmit}
          >
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DrawerFooter>
      )}
    >
      <form id="journey-def-form" className="space-y-6" onSubmit={handleSubmit}>
        {/* Basics */}
        <section className="space-y-4">
          <div>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Basics</p>
            <p className="text-xs text-neutral-400">Name, industry pack, and optional linked workflow.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Clinic intake"
              maxLength={200}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="journey-industry-pack"
                className="text-sm font-medium text-neutral-700 dark:text-neutral-200"
              >
                Industry pack
              </label>
              <input
                id="journey-industry-pack"
                list="journey-industry-suggestions"
                value={form.industryPack}
                onChange={(e) => setForm((f) => ({ ...f, industryPack: e.target.value }))}
                placeholder="generic"
                maxLength={60}
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <datalist id="journey-industry-suggestions">
                {INDUSTRY_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <p className="text-xs text-neutral-400">Suggestions: generic, healthcare, bfsi — or type your own.</p>
            </div>
          </div>

          <div className={isEdit ? 'grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end' : undefined}>
            <Select
              label="Linked workflow"
              hint="Active automations only. Used when a journey instance should resume a workflow."
              options={workflowOptions}
              value={form.linkedWorkflowId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => ({ ...f, linkedWorkflowId: v === '' ? null : v }));
              }}
            />
            {isEdit && (
              <div className="pb-1">
                <Toggle
                  label="Active"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
              </div>
            )}
          </div>
        </section>

        {/* Branding — no shared ColorPicker component exists (Tags use an inline
            palette; ManagePipelineDrawer uses native type=color). Reuse the
            pipeline native picker for free hex primaryColor.
            Banner upload mirrors ProfileSection avatar UX via uploadFileToS3 +
            GET /api/journeys/banner-upload-url; stored value is the public HTTPS
            object URL (brandingConfig.bannerImageUrl) — no schema change. */}
        <section className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Branding</p>
              <p className="text-xs text-neutral-400">
                Optional primary color and banner image for the public journey page.
              </p>
            </div>
            {form.brandingConfig && (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, brandingConfig: null }))}
                className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                Clear branding
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(12rem,auto)_1fr] sm:items-start">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Primary color</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="relative flex-shrink-0 cursor-pointer" title="Primary color">
                  <span
                    className="block h-9 w-9 rounded-full border-2 border-white shadow ring-1 ring-neutral-200 dark:ring-neutral-700"
                    style={{ backgroundColor: form.brandingConfig?.primaryColor || DEFAULT_PRIMARY_COLOR }}
                  />
                  <input
                    type="color"
                    value={form.brandingConfig?.primaryColor || DEFAULT_PRIMARY_COLOR}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      brandingConfig: patchBranding(f.brandingConfig, { primaryColor: e.target.value }),
                    }))}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label="Primary color"
                  />
                </label>
                <input
                  value={form.brandingConfig?.primaryColor ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setForm((f) => ({
                      ...f,
                      brandingConfig: patchBranding(f.brandingConfig, { primaryColor: v || undefined }),
                    }));
                  }}
                  placeholder={DEFAULT_PRIMARY_COLOR}
                  maxLength={20}
                  className="w-32 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-900 outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  aria-label="Primary color hex"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Banner image</p>
              <div className="flex flex-wrap items-center gap-3">
                {form.brandingConfig?.bannerImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary tenant HTTPS URL from public assets bucket
                  <img
                    src={form.brandingConfig.bannerImageUrl}
                    alt="Journey banner preview"
                    className="h-14 max-w-[12rem] rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-700"
                  />
                ) : (
                  <div className="flex h-14 w-28 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-400 dark:border-neutral-600">
                    No banner
                  </div>
                )}
                <div>
                  <input
                    ref={bannerFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleBannerSelect}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    loading={uploadingBanner}
                    onClick={() => bannerFileInputRef.current?.click()}
                  >
                    {form.brandingConfig?.bannerImageUrl ? 'Replace banner' : 'Upload banner'}
                  </Button>
                  {form.brandingConfig?.bannerImageUrl && (
                    <button
                      type="button"
                      className="ml-2 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                      onClick={() => setForm((f) => ({
                        ...f,
                        brandingConfig: patchBranding(f.brandingConfig, { bannerImageUrl: undefined }),
                      }))}
                    >
                      Remove
                    </button>
                  )}
                  <p className="mt-1 text-xs text-neutral-400">JPG, PNG, or WebP up to 2MB</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Screens — ManagePipelineDrawer interaction pattern (sales/page.tsx) */}
        <section className="space-y-3">
          <div>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Screens</p>
            <p className="text-xs text-neutral-400">
              Ordered steps shown to the end user. Reorder with the arrows — no drag-and-drop.
            </p>
          </div>

          {form.screens.map((screen, si) => (
            <div
              key={screen.id}
              className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <input
                  value={screen.title}
                  onChange={(e) => patchScreen(si, { title: e.target.value })}
                  className={`${rowInputCls} min-w-[12rem] flex-1`}
                  maxLength={200}
                  placeholder="Screen title"
                  aria-label={`Screen ${si + 1} title`}
                />
                <input
                  value={screen.id}
                  onChange={(e) => patchScreen(si, { id: e.target.value })}
                  className={`${rowInputCls} w-36 shrink-0 font-mono text-xs`}
                  maxLength={80}
                  placeholder="id"
                  aria-label={`Screen ${si + 1} id`}
                  title="Unique within this definition"
                />
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={si === 0}
                    onClick={() => moveScreen(si, -1)}
                    aria-label="Move screen up"
                    className={rowBtnCls}
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={si === form.screens.length - 1}
                    onClick={() => moveScreen(si, 1)}
                    aria-label="Move screen down"
                    className={rowBtnCls}
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeScreen(si)}
                    aria-label="Remove screen"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-error-500 hover:bg-error-50 sm:h-7 sm:w-7 dark:hover:bg-error-900/20"
                    title="Remove screen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Fields nested one level down — same up/down/add/delete pattern */}
              <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                {screen.fields.map((field, fi) => (
                  <div
                    key={field.id}
                    className="rounded-lg border border-neutral-100 bg-neutral-50/80 p-3 dark:border-neutral-800 dark:bg-neutral-950/40"
                  >
                    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.7fr)_8rem_auto_auto]">
                      <input
                        value={field.label}
                        onChange={(e) => patchField(si, fi, { label: e.target.value })}
                        className={rowInputCls}
                        maxLength={200}
                        placeholder="Field label"
                        aria-label={`Field label ${fi + 1}`}
                      />
                      <input
                        value={field.id}
                        onChange={(e) => patchField(si, fi, { id: e.target.value })}
                        className={`${rowInputCls} font-mono text-xs`}
                        maxLength={80}
                        placeholder="id"
                        aria-label={`Field id ${fi + 1}`}
                      />
                      <select
                        value={field.type}
                        onChange={(e) => patchField(si, fi, { type: e.target.value as JourneyFieldType })}
                        className={`${selectCls} w-full`}
                        aria-label={`Field type ${fi + 1}`}
                      >
                        {FIELD_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          onChange={(e) => patchField(si, fi, {
                            required: e.target.checked ? true : false,
                          })}
                          className="h-3.5 w-3.5 rounded border-neutral-300"
                        />
                        Required
                      </label>
                      <div className="flex shrink-0 items-center gap-1 justify-self-end">
                        <button
                          type="button"
                          disabled={fi === 0}
                          onClick={() => moveField(si, fi, -1)}
                          aria-label="Move field up"
                          className={rowBtnCls}
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={fi === screen.fields.length - 1}
                          onClick={() => moveField(si, fi, 1)}
                          aria-label="Move field down"
                          className={rowBtnCls}
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(si, fi)}
                          aria-label="Remove field"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-error-500 hover:bg-error-50 sm:h-7 sm:w-7 dark:hover:bg-error-900/20"
                          title="Remove field"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {isChoiceType(field.type) && (
                      <div className="mt-2 space-y-1.5 pl-1">
                        <p className="text-[11px] font-medium text-neutral-500">Options</p>
                        {(field.options ?? []).map((opt, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <input
                              value={opt}
                              onChange={(e) => setFieldOption(si, fi, oi, e.target.value)}
                              className={rowInputCls}
                              maxLength={200}
                              placeholder={`Option ${oi + 1}`}
                              aria-label={`Option ${oi + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() => removeFieldOption(si, fi, oi)}
                              aria-label={`Remove option ${oi + 1}`}
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-error-500 hover:bg-error-50 sm:h-7 sm:w-7 dark:hover:bg-error-900/20"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addFieldOption(si, fi)}
                          className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary-600"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add option
                        </button>
                      </div>
                    )}

                    {field.type === 'number' && (
                      <div className="mt-2 pl-1">
                        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <span className="shrink-0 text-[11px] font-medium text-neutral-500">
                            Unit Price (₹)
                          </span>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={typeof field.unitPrice === 'number' ? field.unitPrice : ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                patchField(si, fi, { unitPrice: undefined });
                                return;
                              }
                              const n = Number(raw);
                              if (!Number.isFinite(n) || n < 0) return;
                              patchField(si, fi, { unitPrice: n });
                            }}
                            className={`${rowInputCls} sm:max-w-[10rem]`}
                            placeholder="Optional — leave blank for none"
                            aria-label={`Unit price for field ${fi + 1}`}
                          />
                        </label>
                        <p className="mt-1 text-[10px] text-neutral-400">
                          Optional. Blank = no price line. 0 = free item (still shown).
                        </p>
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addField(si)}
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-2.5 py-2 text-xs text-neutral-500 hover:border-primary-300 hover:text-primary-600 dark:border-neutral-700 dark:hover:border-primary-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add field
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addScreen}
            className="flex w-full items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 p-3 text-sm text-neutral-500 transition-colors hover:border-primary-300 hover:text-primary-600 dark:border-neutral-700 dark:hover:border-primary-700"
          >
            <Plus className="h-4 w-4" />
            Add screen
          </button>
        </section>

        {/* GST — definition-level; same visibility gate as public grand total
            (only when ≥1 field has unitPrice). Display-only until payment. */}
        {showGstSection && (
          <section className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
            <div>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">GST</p>
              <p className="text-xs text-neutral-400">
                Optional tax on the review screen total. Not charged — display only for now.
              </p>
            </div>
            <Toggle
              label="Enable GST"
              checked={form.gstEnabled}
              onChange={(e) => setForm((f) => ({ ...f, gstEnabled: e.target.checked }))}
            />
            {form.gstEnabled && (
              <div className="space-y-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <Input
                  label="GST percent"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={String(form.gstPercent)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw.trim() === '') {
                      setForm((f) => ({ ...f, gstPercent: 0 }));
                      return;
                    }
                    const n = Number(raw);
                    if (!Number.isFinite(n)) return;
                    setForm((f) => ({
                      ...f,
                      gstPercent: Math.min(100, Math.max(0, n)),
                    }));
                  }}
                  hint="0–100. Exclusive adds GST on top; inclusive backs tax out of the subtotal."
                />
                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                    GST mode
                  </legend>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                    <input
                      type="radio"
                      name="journey-gst-mode"
                      className="mt-1"
                      checked={form.gstMode === 'exclusive'}
                      onChange={() => setForm((f) => ({ ...f, gstMode: 'exclusive' }))}
                    />
                    <span>
                      <span className="font-medium">Exclusive</span>
                      <span className="block text-xs text-neutral-500">
                        Total = Subtotal + GST (added as its own line)
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                    <input
                      type="radio"
                      name="journey-gst-mode"
                      className="mt-1"
                      checked={form.gstMode === 'inclusive'}
                      onChange={() => setForm((f) => ({ ...f, gstMode: 'inclusive' }))}
                    />
                    <span>
                      <span className="font-medium">Inclusive</span>
                      <span className="block text-xs text-neutral-500">
                        Total stays Subtotal; GST shown as informational breakdown
                      </span>
                    </span>
                  </label>
                </fieldset>
              </div>
            )}
          </section>
        )}
      </form>
    </Drawer>
  );
}
