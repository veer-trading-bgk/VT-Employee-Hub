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
  '/communications': ['owner', 'admin', 'manager', 'sales', 'support'],
  '/customers':      ['owner', 'admin', 'manager', 'sales', 'support'],
  '/sales':          ['owner', 'admin', 'manager', 'sales'],
  '/analytics':      ['owner', 'admin', 'manager'],
  '/automation':     ['owner', 'admin'],
  '/settings':       ['owner', 'admin', 'manager'],
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

// V3 Contact entity (CONTACT# in DynamoDB)
export interface Contact {
  id: string;                   // ULID
  name: string;
  phone: string;                // E.164 format
  email?: string;
  stage: Stage;
  ownerId?: string;
  ownerName?: string;
  tags: string[];
  companyId: string;
  chatStatus: 'open' | 'resolved' | 'pending' | 'unassigned';
  lastMessageAt?: string;       // ISO 8601
  createdAt: string;
  updatedAt: string;
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
