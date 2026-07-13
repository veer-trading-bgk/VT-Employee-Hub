'use client';

import Link from 'next/link';
import { Monitor } from 'lucide-react';

// M2-D: implements docs/v3/06_SCREEN_SPECIFICATIONS.md:898's documented
// (previously unbuilt) behavior — "Workflow builder: not recommended on
// mobile ... Mobile shows a warning ... Viewing and toggling workflows
// works on mobile" (the workflow LIST, a separate page, already works fine
// at any width; only the node-graph canvas itself needed this gate).
export function CanvasMobileGate() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Monitor className="h-8 w-8 text-neutral-300 dark:text-neutral-600" aria-hidden />
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        Building workflows is better on desktop.
      </p>
      <p className="max-w-xs text-xs text-neutral-400">
        The workflow canvas needs a larger screen. Open this page on a desktop or tablet to build or edit a workflow.
      </p>
      <Link
        href="/automation"
        className="mt-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        Back to Automation
      </Link>
    </div>
  );
}
