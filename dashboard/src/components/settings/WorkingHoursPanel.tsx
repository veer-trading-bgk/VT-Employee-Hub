'use client';

import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch, ApiClientError } from '@/lib/api';
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
  const { data: hoursData, isLoading: hoursLoading } = useQuery({
    queryKey: ['hours-config'],
    queryFn: () => apiFetch<{ config: HoursConfig }>('/api/whatsapp/hours-config'),
    staleTime: 30_000,
  });
  const { data: oooData, isLoading: oooLoading } = useQuery({
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

  const saveMut = useMutation({
    mutationFn: async () => {
      await apiFetch('/api/whatsapp/hours-config', { method: 'PUT', body: JSON.stringify(hours) });
      await apiFetch('/api/whatsapp/ooo-config', { method: 'PUT', body: JSON.stringify(ooo) });
    },
    onSuccess: () => {
      toast.success('Working hours saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['hours-config'] });
      qc.invalidateQueries({ queryKey: ['ooo-config'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiClientError ? (e.body?.error as string | undefined) ?? e.message : 'Failed to save working hours';
      toast.error(msg);
    },
  });

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
          <Toggle checked={hours.enabled} onChange={(e) => { setHours((p) => ({ ...p, enabled: e.target.checked })); setDirty(true); }} aria-label="Enable working hours" />
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
              <Toggle checked={ooo.enabled} onChange={(e) => { setOoo((p) => ({ ...p, enabled: e.target.checked })); setDirty(true); }} aria-label="Enable out of office message" />
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
                <p className="mt-1 text-xs text-neutral-500">Supported variables: {'{{name}}'}, {'{{phone}}'}.</p>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" loading={saveMut.isPending} disabled={!dirty} onClick={() => saveMut.mutate()}>
              Save Working Hours
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const inputCls = 'w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
