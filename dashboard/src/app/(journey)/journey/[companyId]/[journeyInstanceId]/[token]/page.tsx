'use client';

/**
 * Public Journey page — Phase 3.
 * Task 1: fetch + three response states (active / finished / invalid).
 * Task 2: multi-screen field rendering on the active state.
 *
 * Pattern: same unauthenticated outside-(v3) approach as form/[id]/page.tsx
 * (plain fetch via NEXT_PUBLIC_API_URL, no apiFetch/auth, no sidebar).
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  JourneyActiveForm,
  JourneyBanner,
  type JourneyScreen,
} from '@/components/journey/JourneyActiveForm';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

const FINISHED = new Set(['completed', 'cancelled', 'expired']);

interface PublicJourneyDefinition {
  name: string | null;
  screens: JourneyScreen[];
  brandingConfig: { primaryColor?: string; bannerImageUrl?: string } | null;
  gstEnabled?: boolean;
  gstPercent?: number;
  gstMode?: 'exclusive' | 'inclusive';
}

interface PublicJourneyPayload {
  success: boolean;
  instance: {
    journeyInstanceId: string;
    status: string;
  };
  definition: PublicJourneyDefinition | null;
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'finished'; status: string; name: string | null; accent: string | null; bannerImageUrl: string | null }
  | { kind: 'active'; data: PublicJourneyPayload; accent: string | null; bannerImageUrl: string | null };

function accentFrom(def: PublicJourneyDefinition | null): string | null {
  const c = def?.brandingConfig?.primaryColor;
  return typeof c === 'string' && c.trim() ? c.trim() : null;
}

function bannerFrom(def: PublicJourneyDefinition | null): string | null {
  const u = def?.brandingConfig?.bannerImageUrl;
  return typeof u === 'string' && u.trim() ? u.trim() : null;
}

function finishedCopy(status: string): { title: string; body: string } {
  if (status === 'completed') {
    return { title: 'Journey complete', body: 'This link has already been completed. Thank you.' };
  }
  if (status === 'cancelled') {
    return { title: 'Journey cancelled', body: 'This journey is no longer available.' };
  }
  if (status === 'expired') {
    return { title: 'Link expired', body: 'This journey link has expired and can no longer be used.' };
  }
  return { title: 'Journey closed', body: 'This journey is no longer accepting responses.' };
}

function normalizeScreens(raw: unknown): JourneyScreen[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => {
    const screen = (s && typeof s === 'object' ? s : {}) as Partial<JourneyScreen>;
    const fields = Array.isArray(screen.fields) ? screen.fields : [];
    return {
      id: typeof screen.id === 'string' && screen.id ? screen.id : `screen_${i + 1}`,
      title: typeof screen.title === 'string' ? screen.title : `Step ${i + 1}`,
      fields: fields.map((f, j) => {
        const field = (f && typeof f === 'object' ? f : {}) as Partial<JourneyScreen['fields'][number]>;
        return {
          id: typeof field.id === 'string' && field.id ? field.id : `field_${j + 1}`,
          label: typeof field.label === 'string' ? field.label : 'Field',
          type: typeof field.type === 'string' ? field.type : 'text',
          ...(field.required ? { required: true } : {}),
          ...(Array.isArray(field.options) ? { options: field.options.map(String) } : {}),
          ...(typeof field.unitPrice === 'number' && field.unitPrice >= 0
            ? { unitPrice: field.unitPrice }
            : {}),
        };
      }),
    };
  });
}

export default function PublicJourneyPage() {
  const params = useParams<{
    companyId: string;
    journeyInstanceId: string;
    token: string;
  }>();

  const companyId = String(params.companyId ?? '');
  const journeyInstanceId = String(params.journeyInstanceId ?? '');
  const token = String(params.token ?? '');

  const [state, setState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    if (!companyId || !journeyInstanceId || !token) {
      setState({ kind: 'invalid' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    fetch(`${API_BASE}/api/journeys/${encodeURIComponent(companyId)}/${encodeURIComponent(journeyInstanceId)}/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: 'invalid' });
          return;
        }
        const data = (await res.json()) as PublicJourneyPayload;
        if (!data?.success || !data.instance) {
          setState({ kind: 'invalid' });
          return;
        }
        const def = data.definition
          ? { ...data.definition, screens: normalizeScreens(data.definition.screens) }
          : null;
        const normalized = { ...data, definition: def };
        const accent = accentFrom(def);
        const bannerImageUrl = bannerFrom(def);
        const status = data.instance.status;
        if (FINISHED.has(status)) {
          setState({
            kind: 'finished',
            status,
            name: def?.name ?? null,
            accent,
            bannerImageUrl,
          });
          return;
        }
        setState({ kind: 'active', data: normalized, accent, bannerImageUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'invalid' });
      });

    return () => { cancelled = true; };
  }, [companyId, journeyInstanceId, token]);

  const shellStyle = useMemo(() => {
    const accent =
      state.kind === 'active' || state.kind === 'finished' ? state.accent : null;
    return accent
      ? ({
          ['--journey-accent' as string]: accent,
          background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 12%, white) 0%, #f8fafc 40%)`,
        } as React.CSSProperties)
      : ({ background: 'linear-gradient(180deg, #f1f5f9 0%, #f8fafc 40%)' } as React.CSSProperties);
  }, [state]);

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50" data-testid="journey-loading">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center"
        data-testid="journey-invalid"
      >
        <h1 className="text-xl font-semibold text-slate-900">Link not found or expired</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          This journey link is invalid, expired, or no longer available. If you believe this is a mistake,
          ask the sender for a new link.
        </p>
      </div>
    );
  }

  if (state.kind === 'finished') {
    const copy = finishedCopy(state.status);
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-6 text-center"
        style={shellStyle}
        data-testid="journey-finished"
        data-status={state.status}
      >
        <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <JourneyBanner url={state.bannerImageUrl} />
          {state.accent && (
            <div
              className="mb-4 h-1.5 w-16 rounded-full"
              style={{ backgroundColor: state.accent }}
              aria-hidden
            />
          )}
          {state.name && (
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{state.name}</p>
          )}
          <h1 className="text-xl font-semibold text-slate-900">{copy.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{copy.body}</p>
        </div>
      </div>
    );
  }

  const { data, accent, bannerImageUrl } = state;
  const def = data.definition;

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={shellStyle}
      data-testid="journey-active"
      data-status={data.instance.status}
    >
      <div className="mx-auto w-full max-w-md">
        <JourneyActiveForm
          name={def?.name ?? null}
          screens={def?.screens ?? []}
          accent={accent}
          bannerImageUrl={bannerImageUrl}
          gst={def ? {
            gstEnabled: def.gstEnabled === true,
            gstPercent: typeof def.gstPercent === 'number' ? def.gstPercent : 0,
            gstMode: def.gstMode === 'inclusive' ? 'inclusive' : 'exclusive',
          } : null}
          companyId={companyId}
          journeyInstanceId={journeyInstanceId}
          token={token}
          apiBase={API_BASE}
          onInvalid={() => setState({ kind: 'invalid' })}
        />
      </div>
    </div>
  );
}
