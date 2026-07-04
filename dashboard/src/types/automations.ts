import type { ReplyButtonValue, CtaButtonValue } from '@/components/shared/ButtonListEditor';

// ── Trigger types ─────────────────────────────────────────────────────────────
export type TriggerType =
  | 'whatsapp_conversation_started'
  | 'lead_created'
  | 'stage_changed'
  | 'stage_change'       // legacy alias from crm.js
  | 'tag_added';

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
  // Company pipeline stage key — an open string, not the closed Stage union:
  // a customized CONFIG#CRM#<companyId> pipeline can have any key, not just
  // the 6 defaults that union represents.
  stage: string;
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

// ── Graph shape (branching automation builder, Phase 2) ──────────────────────
// A workflow is either linear (steps[], above) or graph-shaped (nodes[]/edges[]/
// entryNodeId, below) for its whole lifetime — never both. See AutomationEngine.js's
// _startExecution() on the backend for the dispatch logic this mirrors.
// 'send_buttons'/'send_document' are graph-only — deliberately not added to
// ActionType, which the legacy linear model also uses and has no equivalent for.
export type NodeType = ActionType | 'condition' | 'send_buttons' | 'send_document'
  | 'send_message' | 'send_list' | 'send_location';

// Optional image/video/document shown above the body text — Meta's Interactive
// Message header field. WhatsAppSendService.sendInteractive() is a raw pass-through
// (confirmed by reading it), so this is UI/config only, no service change. Same
// url-or-s3Key shape as SendDocumentConfig below (deliberately — a config-time
// upload only has an s3Key; Meta media_ids expire in 30 days, so this resolves to
// one at send time via WhatsAppSendService.resolveMediaId(), never stores one).
export interface SendButtonsHeader {
  type:      'image' | 'video' | 'document';
  url?:      string;
  s3Key?:    string;
  mimeType?: string;
  filename?: string;
}

// Reuses the exact config shape CONFIG#WELCOME# / ButtonListEditor.tsx already
// define for WhatsApp buttons — a canvas "Send Buttons" node sends the identical
// message shape a welcome-message config does, just mid-workflow instead of on
// first contact. See ButtonListEditor.tsx's own header comment: it was written
// expecting exactly this kind of second caller.
export interface SendButtonsConfig {
  messageType: 'reply_buttons' | 'cta_buttons';
  bodyText:    string;
  buttons?:    ReplyButtonValue[];  // reply_buttons mode, max 3 (Meta limit)
  ctaButtons?: CtaButtonValue[];    // cta_buttons mode, max 1 (Meta limit)
  header?:     SendButtonsHeader;
}

// A document (or other media) sent with an optional caption, in one message —
// WhatsAppSendService.sendMedia() already supports this fully (confirmed: caption
// is set on the same Graph API call as the document, not a second message). Either
// a public url (Meta fetches it directly) or an uploaded file (s3Key, resolved to
// a Meta media_id at send time via WhatsAppSendService.resolveMediaId() — there's
// no lead/target yet to send to at config time, only at real execution time).
export interface SendDocumentConfig {
  url?:      string;
  s3Key?:    string;
  mimeType?: string;
  filename?: string;
  caption?:  string;
}

// Plain Message node (Item 1a) — freeform text via WhatsAppSendService.sendText().
// No messageType branching (unlike SendButtonsConfig) since this node has no
// buttons/template option at all, just body text with {{name}}/{{phone}}
// substitution. The 24h-customer-service-window hint shown in
// SendMessageEditor.tsx is UI-only (ComposerToolbar.tsx shows the same
// warning) — Meta itself is the actual enforcement point.
export interface SendMessageConfig {
  messageText: string;
}

// Message + List node (Item 1b) — Meta's WhatsApp Interactive List message.
// Deliberately single-section (max 10 rows total, Meta's own platform limit)
// — multi-section lists exist in Meta's spec but add UI complexity this v1
// skips; see ListRowEditor.tsx's own comment.
export interface ListRow {
  id:           string;
  title:        string;
  description?: string;
}
export interface SendListConfig {
  bodyText:   string;
  buttonText: string;
  rows:       ListRow[];
}

// Send Location node (Item 1c) — dropdown-based config referencing a saved
// CONFIG#BRANCH# office record (see BranchSelect.tsx) rather than free-typed
// lat/long per workflow; resolved to real coordinates at execution time by
// AutomationEngine.js, the same "config-time reference, execution-time
// resolution" shape SendButtonsHeader/SendDocumentConfig already use for
// uploaded media.
export interface SendLocationConfig {
  branchId: string;
}

export type ConditionMode = 'field_match' | 'boolean' | 'button_reply';

export interface ConditionBranch {
  key:       string;   // matches an edge's sourceHandle
  label?:    string;
  value?:    string;   // field_match: the comparison value for this branch
  buttonId?: string;   // button_reply: the WhatsApp button id this branch fires on
}

export interface ConditionNodeConfig {
  mode:           ConditionMode;
  field?:         ConditionField;       // field_match / boolean
  operator?:      ConditionOperator;    // field_match / boolean
  value?:         string;               // boolean only — single comparison value
  branches?:      ConditionBranch[];    // field_match / button_reply
  fallbackKey?:   string;               // branch to follow when nothing matches / times out
  timeoutAmount?: number;               // button_reply only
  timeoutUnit?:   'minutes' | 'hours' | 'days';
}

export type NodeConfig = StepConfig | ConditionNodeConfig | SendButtonsConfig | SendDocumentConfig
  | SendMessageConfig | SendListConfig | SendLocationConfig;

export interface NodePosition {
  x: number;
  y: number;
}

export interface GraphNode {
  id:        string;
  type:      NodeType;
  config:    NodeConfig;
  position?: NodePosition; // absent on a freshly-added node — canvas runs Dagre to place it
}

export interface GraphEdge {
  id:           string;
  source:       string;
  target:       string;
  sourceHandle?: string; // which branch of the source node (condition nodes only)
  label?:       string;
}

export function isConditionConfig(config: NodeConfig): config is ConditionNodeConfig {
  return typeof (config as ConditionNodeConfig).mode === 'string';
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
  steps?:         WorkflowStep[];
  nodes?:         GraphNode[];
  edges?:         GraphEdge[];
  entryNodeId?:   string;
  runCount:       number;
  lastRunAt?:     string | null;
  createdBy:      string;
  createdByName?: string | null;
  createdAt:      string;
  updatedAt:      string;
}

export function isGraphWorkflow(workflow: Pick<Workflow, 'nodes'>): boolean {
  return Array.isArray(workflow.nodes) && workflow.nodes.length > 0;
}

// ── Executions ───────────────────────────────────────────────────────────────
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'partial_failure' | 'paused';
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

// ── Graph execution trace (branching automation builder, Phase 2) ────────────
// A graph execution only ever visits one path per run, so it's recorded as an
// append-only path[] instead of linear's fixed-size steps[] — see
// AutomationEngine.js's _finalizeExecution() on the backend.
export type PathStatus = 'completed' | 'failed' | 'waiting' | 'waiting_reply' | 'evaluated' | 'timed_out';

export interface ExecutionPathEntry {
  nodeId:       string;
  type:         NodeType;
  status:       PathStatus;
  startedAt?:   string;
  completedAt?: string;
  resumeAt?:    string;
  result?:      Record<string, unknown>;
  error?:       string;
  branchKey?:   string | null; // which branch a 'condition' node resolved to
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
  steps?:        ExecutionStep[];
  path?:         ExecutionPathEntry[];
  startedAt:     string;
  completedAt?:  string;
  durationMs?:   number;
  error?:        string;
}

export function isGraphExecution(execution: Pick<Execution, 'path'>): boolean {
  return Array.isArray(execution.path) && execution.path.length > 0;
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
  running:         { label: 'Running',         variant: 'primary' },
  completed:       { label: 'Completed',       variant: 'success' },
  failed:          { label: 'Failed',          variant: 'error'   },
  partial_failure: { label: 'Partial Failure', variant: 'warning' },
  paused:          { label: 'Paused',          variant: 'warning' },
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
