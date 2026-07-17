'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FLOW_LIMITS, SINGLETON_COMPONENT_TYPES, type FlowComponent, type FlowComponentType } from '@/types/flowBuilder';
import { COMPONENT_META, PALETTE_GROUPS } from './componentMeta';

interface ComponentPaletteProps {
  /** Current screen's components — drives the 50-cap and singleton gating. */
  components: FlowComponent[];
  onAdd: (type: FlowComponentType) => void;
}

/**
 * Click-to-add picker, deliberately NOT drag-from-palette — same convention as
 * the automation canvas's NodePalette / WorkflowBuilder's "+" picker, so the
 * builders feel related. The "+ Add Component" button expands an inline grouped
 * list; clicking a type appends it to the screen stack.
 */
export function ComponentPalette({ components, onAdd }: ComponentPaletteProps) {
  const [open, setOpen] = useState(false);
  const screenFull = components.length >= FLOW_LIMITS.maxComponentsPerScreen;
  const presentTypes = new Set(components.map((c) => c.type));

  if (screenFull) {
    return (
      <p className="text-[11px] text-neutral-400">
        Maximum {FLOW_LIMITS.maxComponentsPerScreen} components per screen (Meta limit)
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        {open ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        Add Component ({components.length}/{FLOW_LIMITS.maxComponentsPerScreen})
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid grid-cols-2 gap-2.5">
            {PALETTE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400/70 dark:text-neutral-500">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.types.map((type) => {
                    const { label, icon: Icon } = COMPONENT_META[type];
                    const singletonTaken = SINGLETON_COMPONENT_TYPES.has(type) && presentTypes.has(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={singletonTaken}
                        onClick={() => {
                          onAdd(type);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium',
                          singletonTaken
                            ? 'cursor-not-allowed text-neutral-300 dark:text-neutral-600'
                            : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                        {label}
                        {singletonTaken && <span className="ml-auto text-[10px] font-normal">added</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
