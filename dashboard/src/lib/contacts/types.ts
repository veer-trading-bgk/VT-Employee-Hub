// ── Shared types for Customer 360 ────────────────────────────────────────────

export interface Followup {
  leadId: string;
  leadName?: string;
  leadPhone?: string;
  date: string;
  note?: string;
  done?: boolean;
}

export interface ContactDetail {
  PK?: string;
  leadId: string;
  name: string;
  phone: string;
  email?: string | null;
  stage: string;
  productInterest: string[];
  source: string;
  notes: string;
  tags: string[];
  closureDeadline?: string | null;
  assignedTo: string;
  assignedToName?: string | null;
  chatStatus?: 'open' | 'unassigned' | 'resolved' | null;
  lastInboundAt?: string | null;
  createdAt: string;
  updatedAt: string;
  convertedAt?: string | null;
  messageCount?: number;
  // Reserved — Phase 2 Deal Tracking
  expectedValue?: number | null;
  probability?: number | null;
  // Reserved — Phase 2 AI
  healthScore?: number | null;
  // Reserved — Phase 2 Customer Journey
  milestones?: {
    meeting?: { date: string; actor: string; notes?: string };
    retention?: { date: string };
    referral?: { date: string; referredContactId: string };
  };
  // Reserved — Phase 3 Relationship Graph
  relationships?: Array<{
    type: 'company' | 'decision_maker' | 'influencer' | 'referral' | 'family' | 'accountant';
    contactId: string;
    label?: string;
  }>;
}

export interface ContactMessage {
  SK: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sentByName?: string;
  authorName?: string;
  timestamp: string;
  type?: string;
  mediaId?: string;
  mediaUrl?: string;
  s3Key?: string;
  mimeType?: string;
  filename?: string;
  msgStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  waMessageId?: string;
  replyToWaMessageId?: string;
  replyToContent?: string;
  replyToDirection?: 'inbound' | 'outbound';
  replyToSenderName?: string | null;
}

export type TimelineItem =
  | (ContactMessage & { _kind: 'message' })
  | (ContactMessage & { _kind: 'note' });

export interface ContactDetailResponse {
  success: boolean;
  lead: ContactDetail;
  messages: ContactMessage[];
  internalNotes: ContactMessage[];
}

export type TabId =
  | 'profile'
  | 'conversation'
  | 'timeline'
  | 'crm'
  | 'tasks'
  | 'notes'
  | 'documents';

export const VALID_TAB_IDS: TabId[] = [
  'profile', 'conversation', 'timeline', 'crm', 'tasks', 'notes', 'documents',
];

export const CONTACT_TABS: { id: TabId; label: string; mobileLabel: string }[] = [
  { id: 'profile',      label: 'Profile',      mobileLabel: 'Profile'  },
  { id: 'conversation', label: 'Conversation',  mobileLabel: 'Convo'   },
  { id: 'timeline',     label: 'Timeline',      mobileLabel: 'Timeline' },
  { id: 'crm',          label: 'CRM',           mobileLabel: 'CRM'     },
  { id: 'tasks',        label: 'Tasks',         mobileLabel: 'Tasks'   },
  { id: 'notes',        label: 'Notes',         mobileLabel: 'Notes'   },
  { id: 'documents',    label: 'Documents',     mobileLabel: 'Docs'    },
];
