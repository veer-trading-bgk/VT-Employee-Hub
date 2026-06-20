'use client';

import { BulkEntryPage } from '@/components/bulk-entry/BulkEntryPage';

export default function ManagerBulkEntryPage() {
  return (
    <BulkEntryPage
      performersUrl="/api/metrics/performers"
      directoryHref="/leaderboard"
      title="Add Team Metrics"
    />
  );
}
