import type { Stage } from './v3';

// ── Trigger types ─────────────────────────────────────────────────────────────
export type TriggerType =
  | 'whatsapp_conversation_started'
  | 'lead_created'
  | 'stage_changed'
  | 'stage_change'       // legacy alias from crm.js
  | 'tag_added'
  | 'campaign_completed';

export type ActionType =
  | 'send_template'
  | 'assign_employee'
  | 'change_stage'
  | 'add_tag'
  | 'create_task'
  | 'wait'
  | 'end';

export type ConditionOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'exists' | 'not_exists';

export type ConditionField = 'stage' | 'from_stage' | 'to_stage' | 'source' | 'tags' | 'assignedTo';

export interface WorkflowCondition {
  field:    ConditionField;
  operator: ConditionOperator;
  value?:   string;
}

export interface WorkflowTrigger {
  type:       TriggerType;
  conditions: WorkflowCondition[];
}

// ── Step config variants ──────────────────────────────────────────────────────
export interface SendTemplateConfig {
  templateName: string;
  language:     string;
  variables:    string[];
}

export interface AssignEmployeeConfig {
  employeeId:    string;
  employeeName?: string;
}

export interface ChangeStageConfig {
  stage: Stage;
}

export interface AddTagConfig {
  tag: string;
}

export interface CreateTaskConfig {
  daysFromNow: number;
  note?:       string;
}

export interface WaitConfig {
  amount: number;
  unit:   'minutes' | 'hours' | 'days';
}

export type StepConfig =
  | SendTemplateConfig
  | AssignEmployeeConfig
  | ChangeStageConfig
  | AddTagConfig
  | CreateTaskConfig
  | WaitConfig
  | Record<string, never>;

export interface WorkflowStep {
  id:     string;
  type:   ActionType;
  config: StepConfig;
}

// ── Workflow ─────────────────────────────────────────────────────────────────
export type WorkflowStatus = 'active' | 'draft' | 'paused' | 'archived';

export interface Workflow {
  id:             string;
  companyId:      string;
  name:           string;
  description?:   string | null;
  status:         WorkflowStatus;
  trigger:        WorkflowTrigger | TriggerType; // legacy: trigger was a string
  steps:          WorkflowStep[];
  runCount:       number;
  lastRunAt?:     string | null;
  createdBy:      string;
  createdByName?: string | null;
  createdAt:      string;
  updatedAt:      string;
}

// ── Executions ───────────────────────────────────────────────────────────────
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'paused';
export type StepStatus      = 'pending' | 'running' | 'completed' | 'failed' | 'waiting';

export interface ExecutionStep {
  stepId:       string;
  type:         ActionType;
  status:       StepStatus;
  startedAt?:   string;
  completedAt?: string;
  resumeAt?:    string;
  result?:      Record<string, unknown>;
  error?:       string;
}

export interface Execution {
  executionId:   string;
  workflowId:    string;
  workflowName:  string;
  companyId:     string;
  status:        ExecutionStatus;
  contactId?:    string | null;
  contactName?:  string | null;
  leadPK?:       string | null;
  triggeredBy:   { type: string; entityId: string };
  steps:         ExecutionStep[];
  startedAt:     string;
  completedAt?:  string;
  durationMs?:   number;
  error?:        string;
}

// ── API response shapes ───────────────────────────────────────────────────────
export interface AutomationStats {
  total:           number;
  active:          number;
  draft:           number;
  paused:          number;
  totalExecutions: number;
  successRate:     number;
}

export interface AutomationsResponse   { success: boolean; automations: Workflow[]  }
export interface AutomationResponse    { success: boolean; automation:  Workflow    }
export interface ExecutionsResponse    { success: boolean; executions:  Execution[] }
export interface AutomationStatsResponse { success: boolean; stats: AutomationStats }

// ── UI metadata ───────────────────────────────────────────────────────────────
export const TRIGGER_META: Record<string, { label: string; description: string }> = {
  whatsapp_conversation_started: { label: 'New WA Conversation', description: 'First WhatsApp message from a contact' },
  lead_created:                  { label: 'Lead Created',        description: 'A new lead is added to the CRM'        },
  stage_changed:                 { label: 'Stage Changed',       description: 'A lead moves to a new pipeline stage'  },
  stage_change:                  { label: 'Stage Changed',       description: 'A lead moves to a new pipeline stage'  },
  tag_added:                     { label: 'Tag Added',           description: 'A tag is added to a lead'              },
  campaign_completed:            { label: 'Campaign Completed',  description: 'A WhatsApp broadcast finishes'         },
};

export const ACTION_META: Record<ActionType, { label: string; description: string }> = {
  send_template:   { label: 'Send Template',   description: 'Send a WhatsApp template message'    },
  assign_employee: { label: 'Assign Employee', description: 'Assign the lead to an employee'       },
  change_stage:    { label: 'Change Stage',    description: 'Move the lead to a new pipeline stage'},
  add_tag:         { label: 'Add Tag',         description: 'Add a tag to the lead'               },
  create_task:     { label: 'Create Task',     description: 'Create a follow-up task'             },
  wait:            { label: 'Wait',            description: 'Pause the workflow for a duration'   },
  end:             { label: 'End',             description: 'End the workflow'                    },
};

export const WORKFLOW_STATUS_META: Record<WorkflowStatus, { label: string; variant: 'default' | 'primary' | 'success' | 'warning' | 'error' }> = {
  active:   { label: 'Active',   variant: 'success' },
  draft:    { label: 'Draft',    variant: 'default' },
  paused:   { label: 'Paused',   variant: 'warning' },
  archived: { label: 'Archived', variant: 'error'   },
};

export const EXECUTION_STATUS_META: Record<ExecutionStatus, { label: string; variant: 'default' | 'primary' | 'success' | 'warning' | 'error' }> = {
  running:   { label: 'Running',   variant: 'primary' },
  completed: { label: 'Completed', variant: 'success' },
  failed:    { label: 'Failed',    variant: 'error'   },
  paused:    { label: 'Paused',    variant: 'warning' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
export function getTriggerLabel(workflow: Workflow): string {
  const t = typeof workflow.trigger === 'object' ? workflow.trigger.type : workflow.trigger;
  return TRIGGER_META[t as string]?.label ?? String(t);
}

export function getWorkflowStatus(w: Workflow): WorkflowStatus {
  if (w.status) return w.status;
  return (w as unknown as { enabled?: boolean }).enabled ? 'active' : 'draft';
}

export const PHASE1_ACTIONS: ActionType[] = [
  'send_template', 'assign_employee', 'change_stage', 'add_tag', 'create_task', 'wait', 'end',
];
