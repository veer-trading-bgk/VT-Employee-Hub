'use client';

import { AlertTriangle, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isFormComponent, validateFlow, type FlowScreen } from '@/types/flowBuilder';
import { ScreenTabs } from './ScreenTabs';
import { FlowScreenEditor } from './FlowScreenEditor';

interface FlowScreensEditorProps {
  screens: FlowScreen[];
  onChange: (screens: FlowScreen[]) => void;
  /** Controlled active screen — callers (workspace, harness) own it so
   * validation issues and Meta errors can jump the editor to a screen. */
  activeId: string;
  onActiveChange: (id: string) => void;
}

/**
 * Pure multi-screen editing surface: screen tabs (add/delete/reorder),
 * flow-level validation issues, and the active screen's stack editor.
 * No fetching, no mutations — FlowBuilderWorkspace owns save/publish and the
 * dev harness drives this same component against mock state.
 */
export function FlowScreensEditor({ screens, onChange, activeId, onActiveChange }: FlowScreensEditorProps) {
  const activeIndex = Math.max(0, screens.findIndex((s) => s.id === activeId));
  const active = screens[activeIndex];
  const issues = validateFlow(screens);

  const otherScreens = screens.filter((_, i) => i !== activeIndex);
  const otherScreenIds = new Set(otherScreens.map((s) => s.id));
  const externalFieldNames = new Set(
    otherScreens.flatMap((s) => s.components.filter(isFormComponent).map((c) => c.name)),
  );

  function handleScreenChange(updated: FlowScreen) {
    // Keep selection stable across id edits — the active screen is tracked by
    // id, and editing the Screen ID field changes exactly that id.
    onChange(screens.map((s, i) => (i === activeIndex ? updated : s)));
    if (updated.id !== activeId) onActiveChange(updated.id);
  }

  return (
    <div className="space-y-3">
      <ScreenTabs screens={screens} activeId={active?.id ?? ''} onSelect={onActiveChange} onChange={onChange} />

      {issues.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900" data-testid="flow-validation-issues">
          {issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2">
              {issue.level === 'error' ? (
                <OctagonAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error-500" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500" aria-hidden />
              )}
              <p className={cn('text-xs', issue.level === 'error' ? 'text-error-600 dark:text-error-400' : 'text-neutral-500')}>
                {issue.message}
                {issue.screenIndex !== undefined && screens[issue.screenIndex] && screens[issue.screenIndex].id !== active?.id && (
                  <button
                    type="button"
                    onClick={() => onActiveChange(screens[issue.screenIndex!].id)}
                    className="ml-1.5 font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                  >
                    Go to screen
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {active && (
        <FlowScreenEditor
          screen={active}
          onChange={handleScreenChange}
          otherScreenIds={otherScreenIds}
          externalFieldNames={externalFieldNames}
        />
      )}
    </div>
  );
}
