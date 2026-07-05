import type { Role } from '@/types';

// V3 display roles (mapped from backend V2 roles — backend is locked)
export type V3Role = 'owner' | 'admin' | 'manager' | 'sales' | 'support';

// Maps V2 backend role → V3 display role
export function toV3Role(role: Role): V3Role {
  switch (role) {
    case 'superadmin': return 'owner';
    case 'admin':      return 'admin';
    case 'manager':    return 'manager';
    case 'team_lead':  return 'manager';
    case 'agent':      return 'sales';
    case 'telecaller': return 'sales';
    case 'intern':     return 'support';
    default:           return 'support';
  }
}

// V3 nav route permissions — items are not rendered if not permitted (never disabled)
export const V3_NAV_PERMISSIONS: Record<string, V3Role[]> = {
  '/home':           ['owner', 'admin', 'manager', 'sales', 'support'],
  '/entry':          ['owner', 'admin', 'manager', 'sales', 'support'],
  '/communications': ['owner', 'admin', 'manager', 'sales', 'support'],
  '/contacts':       ['owner', 'admin', 'manager', 'sales', 'support'],
  '/sales':          ['owner', 'admin', 'manager', 'sales'],
  '/attendance':     ['owner', 'admin', 'manager', 'sales', 'support'],
  '/compensation':   ['owner', 'admin', 'manager', 'sales', 'support'],
  '/analytics':      ['owner', 'admin', 'manager'],
  '/automation':     ['owner', 'admin'],
  '/platform':       ['owner'],
  '/settings':       ['owner', 'admin', 'manager', 'sales', 'support'],
};

// V3 role display labels
export const V3_ROLE_LABELS: Record<V3Role, string> = {
  owner:   'Owner',
  admin:   'Admin',
  manager: 'Manager',
  sales:   'Sales',
  support: 'Support',
};

// APForce pipeline stages
export type Stage =
  | 'new_lead'
  | 'contacted'
  | 'interested'
  | 'kyc_done'
  | 'demat_done'
  | 'lost';

export const STAGE_LABELS: Record<Stage, string> = {
  new_lead:    'New Lead',
  contacted:   'Contacted',
  interested:  'Interested',
  kyc_done:    'KYC Done',
  demat_done:  'Demat Done',
  lost:        'Lost',
};

// V3 Contact entity — shape returned by /api/contacts and /api/crm/leads
export interface Contact {
  id: string;                        // leadId for leads, 10-digit phone for unknowns
  type?: 'lead' | 'unknown';         // backend type discriminator
  leadId?: string | null;            // ULID (same as id for leads, null for unknowns)
  displayName?: string;              // always populated: name ?? waName ?? phone
  name: string;                      // may be null at runtime despite the type; use displayName ?? name ?? phone
  phone: string;
  email?: string | null;
  stage: Stage;
  assignedTo?: string | null;
  assignedToName?: string | null;    // backend field name (previously wrongly typed as ownerName)
  ownerId?: string;                  // alias kept for backward compat
  ownerName?: string;                // alias kept for backward compat
  tags: string[];
  companyId?: string;
  chatStatus?: 'open' | 'resolved' | 'pending' | 'unassigned';
  lastMessageAt?: string;
  createdAt?: string;
  updatedAt?: string;                // NOT returned by current API; use lastMessageAt ?? createdAt
  priorityScore?: number | null;     // LeadScoringScheduler — recomputed on a ~60min cycle, not real-time
  priorityTier?: 'hot' | 'warm' | 'cold' | null;
}

// V3 Follow-up entity (FOLLOWUP# in DynamoDB)
export interface Followup {
  id: string;
  contactId: string;
  contactName?: string;
  type: 'call' | 'meeting' | 'message' | 'callback' | 'other';
  notes?: string;
  dueAt: string;                // ISO 8601
  completedAt?: string;
  assignedToId?: string;
  assignedToName?: string;
  createdAt: string;
}

// V3 Conversation entity (CONV# in DynamoDB)
export interface Conversation {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  status: 'open' | 'resolved' | 'pending' | 'unassigned';
  assignedToId?: string;
  assignedToName?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  createdAt: string;
}

// V3 Message entity (MSG# in DynamoDB)
export interface Message {
  id: string;
  conversationId: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'template' | 'sticker';
  content?: string;
  mediaUrl?: string;
  mediaCaption?: string;
  templateName?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: string;
  sentById?: string;
  wamid?: string;
}
