import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type {
  GraphNode, GraphEdge, NodeType, NodeConfig, ConditionNodeConfig, SendButtonsConfig, SendDocumentConfig,
  SendMessageConfig, SendListConfig, SendLocationConfig, SendFlowConfig,
  SendTemplateConfig, AssignEmployeeConfig, ChangeStageConfig, AddTagConfig, CreateTaskConfig,
  StartAiConversationConfig,
} from '@/types/automations';

// A synthetic, non-persisted node representing the workflow's trigger — always
// rendered at the top of the canvas, never written back to workflow.nodes[].
// The trigger itself lives on workflow.trigger, unchanged from Phase 1.
export const TRIGGER_NODE_ID = '__trigger__';

export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: NodeType | 'trigger';
  config:   NodeConfig;
  label?:   string;
}

export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

// ── Backend graph shape → React Flow ──────────────────────────────────────────
export function toReactFlow(
  nodes: GraphNode[],
  edges: GraphEdge[],
  entryNodeId: string | undefined,
  triggerLabel: string,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const rfNodes: CanvasNode[] = [
    {
      id: TRIGGER_NODE_ID,
      type: 'trigger',
      position: { x: 0, y: 0 },
      deletable: false,
      data: { nodeType: 'trigger', config: {}, label: triggerLabel },
    },
    ...nodes.map((n): CanvasNode => ({
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 0, y: 0 },
      data: { nodeType: n.type, config: n.config },
    })),
  ];

  const rfEdges: CanvasEdge[] = [
    ...(entryNodeId
      ? [{ id: `${TRIGGER_NODE_ID}->${entryNodeId}`, source: TRIGGER_NODE_ID, target: entryNodeId }]
      : []),
    ...edges.map((e): CanvasEdge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      label: e.label,
    })),
  ];

  return { nodes: rfNodes, edges: rfEdges };
}

// ── React Flow → backend graph shape (for save, Phase 2 continued) ──────────
export function fromReactFlow(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[]; entryNodeId: string | undefined } {
  const persistable = nodes.filter((n) => n.id !== TRIGGER_NODE_ID);

  const graphNodes: GraphNode[] = persistable.map((n) => ({
    id: n.id,
    type: n.data.nodeType as NodeType,
    config: n.data.config,
    position: n.position,
  }));

  const entryNodeId = edges.find((e) => e.source === TRIGGER_NODE_ID)?.target;

  const graphEdges: GraphEdge[] = edges
    .filter((e) => e.source !== TRIGGER_NODE_ID)
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      label: typeof e.label === 'string' ? e.label : undefined,
    }));

  return { nodes: graphNodes, edges: graphEdges, entryNodeId };
}

// ── Dagre auto-layout ──────────────────────────────────────────────────────────
// Positions only — React Flow still renders. Runs on first open of a workflow with
// no saved positions, or via an explicit "Auto-arrange" action; never on every edit,
// so it can't fight a user's manual repositioning.
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  trigger:       { width: 220, height: 68 },
  condition:     { width: 256, height: 108 },
  wait:          { width: 192, height: 68 },
  end:           { width: 160, height: 56 },
  send_buttons:  { width: 256, height: 84 },
  send_document: { width: 256, height: 84 },
  send_message:  { width: 256, height: 84 },
  send_list:     { width: 256, height: 84 },
  send_location: { width: 256, height: 84 },
  send_flow:     { width: 256, height: 84 },
};
const DEFAULT_DIMENSIONS = { width: 240, height: 76 };

function dimsFor(type: string | undefined): { width: number; height: number } {
  // A fresh object every call — dagre.setNode() stores this label BY REFERENCE and
  // dagre.layout() mutates it in place to add x/y/rank. Returning a shared reference
  // from the lookup table (the original bug here) means every node of the same type
  // writes its computed position into the SAME object, so all same-type nodes end up
  // reporting whichever one was mutated last.
  const d = NODE_DIMENSIONS[type ?? ''] ?? DEFAULT_DIMENSIONS;
  return { width: d.width, height: d.height };
}

// Checked against the raw backend nodes (position genuinely absent), never against
// already-converted CanvasNodes — toReactFlow() defaults a missing position to
// {x:0,y:0} for rendering safety, and {x:0,y:0} is a truthy object, so checking
// post-conversion nodes would always read as "already positioned" and skip layout.
export function needsLayout(nodes: GraphNode[]): boolean {
  return nodes.length > 0 && nodes.some((n) => !n.position);
}

export function applyDagreLayout(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // nodesep/ranksep wider than dagre's defaults — converging edges (multiple branches
  // feeding one downstream node) need enough lateral room that their labels don't
  // visually overlap where the paths come together.
  g.setGraph({ rankdir: 'TB', nodesep: 72, ranksep: 96 });

  nodes.forEach((n) => g.setNode(n.id, dimsFor(n.type)));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    const { width, height } = dimsFor(n.type);
    return { ...n, position: { x: pos.x - width / 2, y: pos.y - height / 2 } };
  });
}

// ── Node face summaries (simplified — full parity with WorkflowBuilder.tsx's
// stepSummary(), which resolves pipeline stage labels, lands once the side panel
// wiring shares that same data; this is deliberately plain for the canvas checkpoint) ──
export function summarizeNodeConfig(nodeType: NodeType, config: NodeConfig): string {
  switch (nodeType) {
    case 'send_template':   return (config as SendTemplateConfig).templateName || 'No template selected';
    case 'assign_employee': return (config as AssignEmployeeConfig).employeeName || (config as AssignEmployeeConfig).employeeId || 'No employee selected';
    case 'change_stage':    return (config as ChangeStageConfig).stage || 'No stage selected';
    case 'add_tag':         return (config as AddTagConfig).tag || 'No tag selected';
    case 'create_task':     return `In ${(config as CreateTaskConfig).daysFromNow ?? 1} day(s)`;
    case 'start_ai_conversation': return (config as StartAiConversationConfig).contextHint || 'Hand off to AI agent';
    default:                return '';
  }
}

export function getConditionQuestion(config: ConditionNodeConfig): string {
  if (config.mode === 'button_reply') return 'Button tapped?';
  const field = config.field ?? 'field';
  return `${field}?`;
}

export function getConditionBranches(config: ConditionNodeConfig): Array<{ key: string; label: string }> {
  if (config.mode === 'boolean') return [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }];
  return (config.branches ?? []).map((b) => ({ key: b.key, label: b.label ?? b.value ?? b.buttonId ?? b.key }));
}

// ── Node palette (add nodes from the canvas toolbar) ──────────────────────────
export const newNodeId = () => `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
export const newEdgeId = () => `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function defaultConditionConfig(): ConditionNodeConfig {
  return { mode: 'field_match', field: 'stage', operator: 'equals', branches: [] };
}

export function defaultSendButtonsConfig(): SendButtonsConfig {
  return { messageType: 'reply_buttons', bodyText: '', buttons: [] };
}

export function defaultSendDocumentConfig(): SendDocumentConfig {
  return {};
}

export function defaultSendMessageConfig(): SendMessageConfig {
  return { messageText: '' };
}

export function defaultSendListConfig(): SendListConfig {
  return { bodyText: '', buttonText: '', rows: [] };
}

export function defaultSendLocationConfig(): SendLocationConfig {
  return { branchId: '' };
}

export function defaultSendFlowConfig(): SendFlowConfig {
  return { flowId: '' };
}

// ── Save-time validation: unconnected branches ────────────────────────────────
// Shallow, referential-integrity-only checking (matches the backend's
// validateGraphShape()) — this specifically catches the "declared a branch,
// never drew its edge" mistake, which otherwise saves silently and only shows up
// the first time a real execution takes that branch and finds nowhere to go.
export interface IncompleteBranchWarning {
  nodeId:            string;
  nodeLabel:         string;
  missingBranchKeys: string[];
}

export function findIncompleteBranches(nodes: CanvasNode[], edges: CanvasEdge[]): IncompleteBranchWarning[] {
  const warnings: IncompleteBranchWarning[] = [];
  for (const n of nodes) {
    if (n.data.nodeType !== 'condition') continue;
    const cfg = n.data.config as ConditionNodeConfig;
    const branches = getConditionBranches(cfg);
    if (branches.length === 0) continue;
    const connectedHandles = new Set(
      edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle),
    );
    const missing = branches.filter((b) => !connectedHandles.has(b.key)).map((b) => b.label || b.key);
    if (missing.length > 0) {
      warnings.push({ nodeId: n.id, nodeLabel: getConditionQuestion(cfg), missingBranchKeys: missing });
    }
  }
  return warnings;
}

// ── Upstream Send Buttons lookup (for button_reply branch selection) ─────────
// The reply-capable options a send_buttons/send_list node exposes as its own
// per-option canvas handles — cta_buttons mode has none (Meta reports no webhook
// event for a CTA/URL tap, see ButtonListEditor.tsx's own comment on this platform
// limitation), so there is nothing such a node could ever branch on.
export function getReplyOptions(nodeType: 'send_buttons' | 'send_list', config: SendButtonsConfig | SendListConfig): Array<{ key: string; label: string }> {
  if (nodeType === 'send_buttons') {
    const cfg = config as SendButtonsConfig;
    if (cfg.messageType === 'cta_buttons') return [];
    return (cfg.buttons ?? []).map((b) => ({ key: b.id, label: b.title }));
  }
  return ((config as SendListConfig).rows ?? []).map((r) => ({ key: r.id, label: r.title }));
}

// Placement for a freshly-added node with no position yet — below the current
// graph's lowest node, centered under it. Not run through Dagre immediately (Dagre
// only runs on first load or the explicit "Auto-arrange" action, never on every
// edit, so it can't fight a user mid-drag); "Auto-arrange" tidies it up later.
export function nextNodePosition(existingNodes: CanvasNode[]): { x: number; y: number } {
  if (existingNodes.length === 0) return { x: 0, y: 0 };
  const maxY = Math.max(...existingNodes.map((n) => n.position.y));
  const avgX = existingNodes.reduce((sum, n) => sum + n.position.x, 0) / existingNodes.length;
  return { x: avgX, y: maxY + 160 };
}
