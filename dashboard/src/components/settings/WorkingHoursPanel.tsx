'use client';

import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch, apiErrorMessage } from '@/lib/api';
import { toast } from 'sonner';

interface DaySchedule { closed: boolean; open: string; close: string; }
type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

interface HoursConfig {
  enabled: boolean;
  timezone: string;
  schedule: Record<Weekday, DaySchedule>;
}
interface OOOConfig { enabled: boolean; messageText: string; }

const DEFAULT_DAY: DaySchedule = { closed: false, open: '09:00', close: '18:00' };
const EMPTY_HOURS: HoursConfig = {
  enabled: false, timezone: 'Asia/Kolkata',
  schedule: {
    monday: DEFAULT_DAY, tuesday: DEFAULT_DAY, wednesday: DEFAULT_DAY, thursday: DEFAULT_DAY,
    friday: DEFAULT_DAY, saturday: { ...DEFAULT_DAY, closed: true }, sunday: { ...DEFAULT_DAY, closed: true },
  },
};
const EMPTY_OOO: OOOConfig = { enabled: false, messageText: '' };

const DAY_LABEL: Record<Weekday, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};
const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * Working Hours + Out of Office (Item 2) — bundled into one panel since
 * they're configured together in practice ("when are we closed" + "what to
 * say when closed"). PRECEDENCE RULE (documented in full in
 * WorkingHoursService.js and enforced in whatsapp.js's webhook): if OOO fires
 * for a message, Welcome Message is skipped for that same message — the two
 * never both fire.
 */
export function WorkingHoursPanel() {
  const { data: hoursData, isLoading: hoursLoading, isError: hoursError, refetch: refetchHours } = useQuery({
    queryKey: ['hours-config'],
    queryFn: () => apiFetch<{ config: HoursConfig }>('/api/whatsapp/hours-config'),
    staleTime: 30_000,
  });
  const { data: oooData, isLoading: oooLoading, isError: oooError, refetch: refetchOoo } = useQuery({
    queryKey: ['ooo-config'],
    queryFn: () => apiFetch<{ config: OOOConfig }>('/api/whatsapp/ooo-config'),
    staleTime: 30_000,
  });

  if (hoursLoading || oooLoading) {
    return (
      <Card className="mt-4">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  // Never mount the Form on a failed fetch of either config — its initial
  // state defaults to fully blank/disabled for whichever one failed, and
  // both toggles auto-save on flip with no confirmation step. Rendering the
  // form here would let one click on an unrelated network blip silently
  // overwrite a real, previously-configured schedule/OOO message with
  // blanks (B3 audit finding #3). Same reference pattern as TagsSection's
  // isError block (settings/page.tsx).
  if (hoursError || oooError) {
    return (
      <Card className="mt-4">
        <div className="py-4 text-center">
          <p className="text-sm text-error-600 dark:text-error-400">Failed to load working hours settings</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => { refetchHours(); refetchOoo(); }}>Retry</Button>
        </div>
      </Card>
    );
  }

  return (
    <WorkingHoursForm
      key={`${JSON.stringify(hoursData?.config)}-${JSON.stringify(oooData?.config)}`}
      initialHours={hoursData?.config}
      initialOOO={oooData?.config}
    />
  );
}

function WorkingHoursForm({ initialHours, initialOOO }: { initialHours: HoursConfig | undefined; initialOOO: OOOConfig | undefined }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState<HoursConfig>({ ...EMPTY_HOURS, ...initialHours });
  const [ooo, setOoo] = useState<OOOConfig>({ ...EMPTY_OOO, ...initialOOO });
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function updateDay(day: Weekday, patch: Partial<DaySchedule>) {
    setHours((prev) => ({ ...prev, schedule: { ...prev.schedule, [day]: { ...prev.schedule[day], ...patch } } }));
    setDirty(true);
  }

  // Takes both configs to save explicitly (both routes are PUT on every
  // save regardless of which toggle changed), plus which toggle (if any)
  // triggered this as an auto-save — needed so onError knows whether/which
  // toggle to revert, versus a manual-save failure that should leave the
  // form alone so the admin can retry. The explicit configs (rather than
  // reading `hours`/`ooo` from this closure) also avoid racing React's
  // state batching: the handlers below call setHours/setOoo + mutate in the
  // same call, so the closure's state could still be the pre-flip value.
  const saveMut = useMutation({
    // Writes the toggle's own config LAST when this is an auto-save
    // (revertTarget set), so onError's revert is always accurate: if the
    // last write throws, nothing new was persisted for that field, so
    // reverting it is correct; if it succeeds, the whole call succeeds and
    // onError never runs. Without this ordering, a hours-toggle auto-save
    // that successfully wrote hours-config but then failed on the
    // unrelated (unchanged) ooo-config write would revert the toggle
    // locally even though the server-side value it cared about was really
    // saved — a real, if narrow, false-negative window this ordering closes.
    mutationFn: async ({ hours: h, ooo: o, revertTarget }: { hours: HoursConfig; ooo: OOOConfig; revertTarget?: 'hours' | 'ooo' }) => {
      const putHours = () => apiFetch('/api/whatsapp/hours-config', { method: 'PUT', body: JSON.stringify(h) });
      const putOoo = () => apiFetch('/api/whatsapp/ooo-config', { method: 'PUT', body: JSON.stringify(o) });
      if (revertTarget === 'hours') { await putOoo(); await putHours(); }
      else { await putHours(); await putOoo(); }
    },
    onSuccess: () => {
      toast.success('Working hours saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['hours-config'] });
      qc.invalidateQueries({ queryKey: ['ooo-config'] });
    },
    onError: (e: unknown, variables) => {
      // Revert whichever toggle triggered its own auto-save failing —
      // never on a manual-save failure (no revertTarget), which should
      // leave the form exactly as the admin left it (see 2026-07-09
      // investigation).
      if (variables.revertTarget === 'hours') setHours((prev) => ({ ...prev, enabled: !variables.hours.enabled }));
      if (variables.revertTarget === 'ooo') setOoo((prev) => ({ ...prev, enabled: !variables.ooo.enabled }));
      toast.error(apiErrorMessage(e, 'Failed to save working hours'));
    },
  });

  // Auto-saves ONLY the master toggle, immediately on flip. If other fields
  // are already mid-edit (dirty), don't silently commit them alongside the
  // toggle; fold the flip into that same pending change and let the
  // existing manual-Save flow cover everything together, unchanged.
  function handleHoursToggleChange(checked: boolean) {
    if (dirty) {
      setHours((prev) => ({ ...prev, enabled: checked }));
      setDirty(true);
      return;
    }
    const nextHours = { ...hours, enabled: checked };
    setHours(nextHours);
    saveMut.mutate({ hours: nextHours, ooo, revertTarget: 'hours' });
  }

  // Same treatment for the nested Out of Office toggle — it turned out to
  // fit the pattern cleanly (both PUTs already fire together on every save
  // regardless of which config changed, so there's no partial-payload
  // wrinkle here).
  function handleOooToggleChange(checked: boolean) {
    if (dirty) {
      setOoo((prev) => ({ ...prev, enabled: checked }));
      setDirty(true);
      return;
    }
    const nextOoo = { ...ooo, enabled: checked };
    setOoo(nextOoo);
    saveMut.mutate({ hours, ooo: nextOoo, revertTarget: 'ooo' });
  }

  const saveButton = (
    <Button size="sm" loading={saveMut.isPending} disabled={!dirty} onClick={() => saveMut.mutate({ hours, ooo })}>
      Save Working Hours
    </Button>
  );

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-neutral-400" aria-hidden />
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Working Hours &amp; Out of Office</p>
              <Badge variant="primary">Built-in trigger</Badge>
            </div>
            <p className="text-xs text-neutral-500">
              Outside these hours, the Out of Office message replies instead of the Welcome Message
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Toggle
            checked={hours.enabled}
            disabled={saveMut.isPending}
            onChange={(e) => handleHoursToggleChange(e.target.checked)}
            aria-label="Enable working hours"
          />
          {hours.enabled && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse working hours settings' : 'Expand working hours settings'}
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {hours.enabled && expanded && (
        <div className="mt-4 space-y-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <div className="w-48">
            <label className="mb-1 block text-xs font-medium text-neutral-500">Timezone</label>
            <input
              value={hours.timezone}
              onChange={(e) => { setHours((p) => ({ ...p, timezone: e.target.value })); setDirty(true); }}
              placeholder="Asia/Kolkata"
              className={inputCls}
            />
          </div>

          <div className="space-y-1.5">
            {WEEKDAYS.map((day) => (
              <div key={day} className="flex items-center gap-2">
                <span className="w-9 text-xs font-medium text-neutral-500">{DAY_LABEL[day]}</span>
                <Toggle
                  checked={!hours.schedule[day].closed}
                  onChange={(e) => updateDay(day, { closed: !e.target.checked })}
                  aria-label={`${day} open`}
                />
                {!hours.schedule[day].closed ? (
                  <>
                    <input type="time" value={hours.schedule[day].open} onChange={(e) => updateDay(day, { open: e.target.value })} className={`${inputCls} w-28`} />
                    <span className="text-xs text-neutral-400">to</span>
                    <input type="time" value={hours.schedule[day].close} onChange={(e) => updateDay(day, { close: e.target.value })} className={`${inputCls} w-28`} />
                  </>
                ) : (
                  <span className="text-xs text-neutral-400">Closed</span>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-500">Out of Office message</label>
              <Toggle
                checked={ooo.enabled}
                disabled={saveMut.isPending}
                onChange={(e) => handleOooToggleChange(e.target.checked)}
                aria-label="Enable out of office message"
              />
            </div>
            {ooo.enabled && (
              <>
                <textarea
                  value={ooo.messageText}
                  onChange={(e) => { setOoo((p) => ({ ...p, messageText: e.target.value })); setDirty(true); }}
                  rows={3}
                  placeholder="We're currently closed, {{name}} — we'll get back to you when we reopen."
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-neutral-500">Supported variables: {'{{name}}'}, {'{{phone}}'}, {'{{source}}'}. Any other {'{{...}}'} pattern will be rejected on Save.</p>
              </>
            )}
          </div>

          <div className="flex justify-end">{saveButton}</div>
        </div>
      )}

      {/* Fallback for CONTENT edits only now — both toggles auto-save
          themselves on flip (see handleHoursToggleChange/handleOooToggleChange
          above) and no longer need a reachable Save button of their own.
          This still covers schedule/timezone/message-text edits, and the
          rare case where a toggle got folded into an already-dirty pending
          change instead of auto-saving (see those handlers' comments). */}
      {dirty && !(hours.enabled && expanded) && (
        <div className="mt-4 flex justify-end border-t border-neutral-100 pt-4 dark:border-neutral-800">
          {saveButton}
        </div>
      )}
    </Card>
  );
}

const inputCls = 'w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
