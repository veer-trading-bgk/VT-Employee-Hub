import type { ReplyButtonValue, CtaButtonValue } from '@/components/shared/ButtonListEditor';

// ── Trigger types ─────────────────────────────────────────────────────────────
export type TriggerType =
  | 'whatsapp_conversation_started'
  | 'lead_created'
  | 'stage_changed'
  | 'stage_change'       // legacy alias from crm.js
  | 'tag_added'
  | 'keyword_message'
  | 'inbound_webhook'
  | 'form_submitted'
  | 'flow_completed';

export type ActionType =
  | 'send_template'
  | 'assign_employee'
  | 'change_stage'
  | 'add_tag'
  | 'create_task'
  | 'start_ai_conversation'
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

// keyword_message trigger's own config — unlike every other trigger type,
// trigger.type alone doesn't define what fires this one; matchMode/keywords
// does. Kept as its own field rather than folded into WorkflowCondition[]
// (which stays a purely optional, AND-only post-fire filter for every trigger
// type, this one included — see AutomationEngine.js's fireTrigger()).
export type KeywordMatchMode = 'exact' | 'contains' | 'any_of';

export interface KeywordTriggerConfig {
  matchMode:      KeywordMatchMode;
  keywords:       string[];   // 1 entry for exact/contains, N for any_of
  caseSensitive?: boolean;    // default false
}

// flow_completed trigger's own config — which registered Flow's completion
// fires this workflow. Unlike KeywordTriggerConfig, entirely optional: a
// blank/absent flowId is the documented "any Flow" catch-all, not an
// authoring error (see AutomationEngine.js's _matchesFlowCompletedConfig).
export interface FlowCompletedTriggerConfig {
  flowId?: string;
}

export interface WorkflowTrigger {
  type:       TriggerType;
  conditions: WorkflowCondition[];
  // keyword_message and flow_completed each carry their own config shape;
  // consumers narrow by trigger.type (no discriminant on the config itself).
  config?:    KeywordTriggerConfig | FlowCompletedTriggerConfig;
  // inbound_webhook only — server-generated capability-URL token (read-only,
  // present once the workflow has been saved at least once with this trigger type).
  webhookToken?:     string;
  // Client sets this to request a fresh token on the next save; the server never
  // persists this flag itself, it only consumes it (see automations.js buildTriggerForStorage).
  regenerateToken?:  boolean;
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

// Hand off to the autonomous AI conversation agent. A simple lead-action (like
// add_tag) — no messaging config of its own, just an optional free-text hint
// (e.g. a tapped button's category) passed as the AI's turn-0 seed so its first
// question can reference it. The real work + guard live in the backend
// (AutomationEngine `start_ai_conversation` -> ConversationalAgentService.startForLead).
export interface StartAiConversationConfig {
  contextHint?: string;
}

export type StepConfig =
  | SendTemplateConfig
  | AssignEmployeeConfig
  | ChangeStageConfig
  | AddTagConfig
  | CreateTaskConfig
  | StartAiConversationConfig
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
  | 'send_message' | 'send_list' | 'send_location' | 'send_flow';

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
  // Only meaningful in reply_buttons mode — a cta_buttons (URL) tap never generates
  // a webhook event to reply to, so this node can't ever pause on one. Flat fields,
  // not a nested object, matching ConditionNodeConfig's timeoutAmount/timeoutUnit.
  replyTimeoutAmount?: number;
  replyTimeoutUnit?:   'minutes' | 'hours' | 'days';
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
  // Every list row is reply-capable (unlike SendButtonsConfig's cta_buttons mode),
  // so no mode gate is needed here.
  replyTimeoutAmount?: number;
  replyTimeoutUnit?:   'minutes' | 'hours' | 'days';
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

// Send Flow node — references a Flow already registered in CONFIG#FLOW#
// (either built in-app or registered by ID, see WhatsAppFlowsPanel.tsx), same
// "config-time reference, execution-time resolution" shape as
// SendLocationConfig above. Tapping the message opens the Flow directly —
// there is no separate button config, unlike SendButtonsConfig/SendListConfig,
// so this node can never pause on a reply the way those two opt-in to.
export interface SendFlowConfig {
  flowId: string;
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
  | SendMessageConfig | SendListConfig | SendLocationConfig | SendFlowConfig;

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
  // Provenance-only marker for which guided on-ramp (if any) created this
  // workflow — absent on every ordinary workflow, including every one that
  // predates this field. Never read by AutomationEngine.js, only by the
  // dashboard (WorkflowList.tsx's "Drip Campaign" chip, eventually a
  // filtered count on the Campaigns page). The workflow itself is fully
  // ordinary either way — this never gates edit/delete/execution.
  source?:        'drip_campaign_template';
  runCount:       number;
  // Absent on any workflow that hasn't completed a run since this field was
  // added (AutomationEngine.js only writes it going forward, no backfill —
  // AUTO_EXEC# history carries a 90-day TTL, so there's nothing to backfill
  // from anyway) — always default to 0, never assume presence.
  successCount?:  number;
  failureCount?:  number;
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
// total/page/pageSize/pages are present only in the paginated mode (GET
// /executions?page=...) — absent in the older unpaginated ?limit= mode
// AutomationDashboard's "recent executions" widget still uses.
export interface ExecutionsResponse    {
  success: boolean; executions: Execution[];
  total?: number; page?: number; pageSize?: number; pages?: number;
}
export interface AutomationStatsResponse { success: boolean; stats: AutomationStats }

// ── UI metadata ───────────────────────────────────────────────────────────────
export const TRIGGER_META: Record<string, { label: string; description: string }> = {
  whatsapp_conversation_started: { label: 'New WA Conversation', description: 'First WhatsApp message from a contact' },
  lead_created:                  { label: 'Lead Created',        description: 'A new lead is added to the CRM'        },
  stage_changed:                 { label: 'Stage Changed',       description: 'A lead moves to a new pipeline stage'  },
  stage_change:                  { label: 'Stage Changed',       description: 'A lead moves to a new pipeline stage'  },
  tag_added:                     { label: 'Tag Added',           description: 'A tag is added to a lead'              },
  keyword_message:               { label: 'Keyword / Button Tap', description: 'Customer types a matching phrase or taps a matching button' },
  inbound_webhook:               { label: 'Inbound Webhook',      description: 'An external system posts to this workflow\'s own URL'      },
  form_submitted:                { label: 'Form Submitted',       description: 'A lead submits a form via the public API (traits available as {{trait.*}} variables)' },
  flow_completed:                { label: 'Flow Completed',       description: 'A customer submits a WhatsApp Flow — optionally only a specific one' },
};

export const ACTION_META: Record<ActionType, { label: string; description: string }> = {
  send_template:   { label: 'Send Template',   description: 'Send a WhatsApp template message'    },
  assign_employee: { label: 'Assign Employee', description: 'Assign the lead to an employee'       },
  change_stage:    { label: 'Change Stage',    description: 'Move the lead to a new pipeline stage'},
  add_tag:         { label: 'Add Tag',         description: 'Add a tag to the lead'               },
  create_task:     { label: 'Create Task',     description: 'Create a follow-up task'             },
  start_ai_conversation: { label: 'Start AI Conversation', description: 'Hand off to the AI conversation agent' },
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
// Legacy workflows stored trigger as a bare string; current ones as the full
// {type, conditions, config?} object. Shared by the linear drawer and the
// branching canvas so both normalize a loaded workflow's trigger identically.
export function normalizeTrigger(trigger: Workflow['trigger']): WorkflowTrigger {
  return typeof trigger === 'object' ? trigger : { type: trigger, conditions: [] };
}

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
