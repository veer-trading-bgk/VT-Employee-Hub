import type { Stage } from '@/types/v3';

export type CampaignType      = 'whatsapp_broadcast' | 'ctwa';
export type CampaignStatus    = 'draft' | 'scheduled' | 'launching' | 'active' | 'completed' | 'cancelled' | 'failed';
export type CampaignObjective = 'awareness' | 'engagement' | 'conversion';
export type ScheduleMode      = 'now' | 'scheduled' | 'draft';

export interface AudienceFilter {
  stages?:    Stage[];
  tags?:      string[];
  assignedTo?: string;
  source?:    string;
}

export interface CampaignStats {
  totalAudience: number;
  sent:          number;
  delivered:     number;
  read:          number;
  replied:       number;
  failed:        number;
}

export interface Campaign {
  id:          string;
  companyId:   string;
  name:        string;
  description?: string | null;
  type:        CampaignType;
  objective:   CampaignObjective;
  status:      CampaignStatus;
  tags:        string[];
  audience:    { filter: AudienceFilter; estimatedCount?: number };
  templateId?:          string | null;
  templateName?:        string | null;
  variableValues?:      string[];
  headerVariableValue?: string | null;
  scheduledAt?:         string | null;
  stats:       CampaignStats;
  createdBy:        string;
  createdByName?:   string | null;
  createdAt:   string;
  updatedAt:   string;
  launchedAt?:    string;
  completedAt?:   string;
}

export interface CampaignDashboardStats {
  total:         number;
  active:        number;
  draft:         number;
  scheduled:     number;
  completed:     number;
  totalAudience: number;
  totalMessages: number;
  deliveryRate:  number;
  readRate:      number;
  replyRate:     number;
}

// API response shapes
export interface CampaignsResponse     { success: boolean; campaigns: Campaign[] }
export interface CampaignResponse      { success: boolean; campaign: Campaign }
export interface CampaignStatsResponse { success: boolean; stats: CampaignDashboardStats }

export interface AudienceRecipient { pk?: string; name: string; phone: string; stage: string; tags: string[] }
export interface AudiencePreviewResponse {
  success:           boolean;
  count:             number;
  exceedsLimit:      boolean;
  duplicatesRemoved?: number;
  invalidPhoneCount?: number;
  recipients?:       AudienceRecipient[] | null;
  recipientsCapped?: boolean;
}

export interface ValidateAudienceResponse {
  success:      boolean;
  valid:        boolean;
  reviewCount:  number;
  currentCount: number;
  delta:        number;
  stats:        { duplicatesRemoved: number; invalidPhoneCount: number };
  removed?:     Array<AudienceRecipient & { reason: string }> | null;
  added?:       Array<AudienceRecipient & { reason: string }> | null;
  validatedAt:  string;
}

export interface LaunchResponse { success: boolean; sent: number; failed: number; total: number; errors: Array<{ phone: string; error: string }> }

// Wizard form state
export interface CampaignFormData {
  name:        string;
  description: string;
  type:        CampaignType;
  objective:   CampaignObjective;
  tags:        string[];
  filter:      AudienceFilter;
  templateId:          string;
  templateName:        string;
  variableValues:      string[];
  headerVariableValue: string;
  scheduleMode:  ScheduleMode;
  scheduledAt:   string;
}

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; variant: 'default' | 'primary' | 'success' | 'warning' | 'error' }> = {
  draft:     { label: 'Draft',     variant: 'default'  },
  scheduled: { label: 'Scheduled', variant: 'warning'  },
  launching: { label: 'Launching', variant: 'primary'  },
  active:    { label: 'Active',    variant: 'primary'  },
  completed: { label: 'Completed', variant: 'success'  },
  failed:    { label: 'Failed',    variant: 'error'    },
  cancelled: { label: 'Cancelled', variant: 'default'  },
};
