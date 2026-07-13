'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/v3/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { TemplateList } from '@/components/templates/TemplateList';
import { TemplateCreateDrawer } from '@/components/templates/TemplateCreateDrawer';

/**
 * Settings → Templates (docs/v3/06_SCREEN_SPECIFICATIONS.md:929,960): a
 * read-only glance at Meta-approved templates, with a "Request New Template"
 * shortcut into the same submission drawer the full-management surfaces use.
 * Full create/edit/delete/sync/AI-draft management stays on the standalone
 * /templates route and the Campaigns → Templates tab — this section reuses
 * TemplateList in readOnly mode rather than duplicating a second list/table.
 *
 * "Request new template" is admin+/owner-only per
 * docs/v3/09_PERMISSION_MATRIX.md:298 (Owner ✓, Admin ✓, Manager ✗) — same
 * raw-role check TemplateList itself uses for canManage (DL-021).
 */
export function SettingsTemplatesSection() {
  const { user } = useAuth();
  const canRequest = user?.role === 'superadmin' || user?.role === 'admin';
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Templates</h2>
          <p className="text-sm text-neutral-500">
            Meta-approved WhatsApp message templates. Full management lives in Campaigns → Templates.
          </p>
        </div>
        {canRequest && (
          <Button size="sm" onClick={() => setDrawerOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Request New Template
          </Button>
        )}
      </div>

      <TemplateList readOnly />

      <TemplateCreateDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
