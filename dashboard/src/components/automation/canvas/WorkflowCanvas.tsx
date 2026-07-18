'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, BackgroundVariant, addEdge,
  type NodeMouseHandler, type OnConnect, type OnNodesDelete, type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Save, Loader2, CheckCircle2, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { nodeTypes } from './nodes';
import { NodeConfigPanel } from './NodeConfigPanel';
import { NodePalette } from './NodePalette';
import { TriggerConfigPanel } from './TriggerConfigPanel';
import {
  toReactFlow, fromReactFlow, applyDagreLayout, needsLayout,
  newNodeId, newEdgeId, defaultConditionConfig, defaultSendButtonsConfig, defaultSendDocumentConfig,
  defaultSendMessageConfig, defaultSendListConfig, defaultSendLocationConfig, defaultSendFlowConfig, defaultMetaSignalConfig, defaultSendInstagramMessageConfig, nextNodePosition,
  findIncompleteBranches, TRIGGER_NODE_ID, type CanvasNodeData,
} from '@/lib/automationGraph';
import { defaultConfig } from '../WorkflowBuilder';
import {
  getTriggerLabel, normalizeTrigger, TRIGGER_META,
  type Workflow, type WorkflowTrigger, type GraphNode, type GraphEdge, type NodeConfig, type ActionType, type NodeType,
} from '@/types/automations';

interface WorkflowCanvasProps {
  workflow: Workflow;
  // Omitted entirely (e.g. the checkpoint's blank /canvas/new scaffold) → no Save
  // button renders at all, rather than a Save button that silently does nothing.
  onSave?: (nodes: GraphNode[], edges: GraphEdge[], entryNodeId: string | undefined, trigger: WorkflowTrigger) => Promise<void>;
}

// 'end' has nothing to configure. The trigger IS configurable (see TriggerNode
// click handling below) but through TriggerConfigPanel, not NodeConfigPanel —
// it isn't a graph node, so it's excluded from this set and handled separately.
const NON_CONFIGURABLE = new Set(['end']);

export function WorkflowCanvas({ workflow, onSave }: WorkflowCanvasProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const requiresLayout = needsLayout(workflow.nodes ?? []);
    const { nodes, edges } = toReactFlow(
      workflow.nodes ?? [],
      workflow.edges ?? [],
      workflow.entryNodeId,
      getTriggerLabel(workflow),
    );
    const laidOut = requiresLayout ? applyDagreLayout(nodes, edges) : nodes;
    return { initialNodes: laidOut, initialEdges: edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  // The trigger isn't a graph node (see automationGraph.ts's TRIGGER_NODE_ID
  // comment) — it lives on workflow.trigger, so it gets its own bit of local
  // state here rather than living inside `nodes`, same source of truth
  // normalizeTrigger() gives the linear drawer.
  const [trigger, setTrigger] = useState<WorkflowTrigger>(() => normalizeTrigger(workflow.trigger));

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (NON_CONFIGURABLE.has(String(node.data?.nodeType))) return;
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  function updateSelectedConfig(config: NodeConfig) {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, config } } : n)));
  }

  // Keeps the visual TriggerNode's label in sync with an in-progress edit —
  // otherwise the canvas would keep showing the old trigger type until the
  // next full reload.
  function handleTriggerChange(next: WorkflowTrigger) {
    setTrigger(next);
    const label = TRIGGER_META[next.type]?.label ?? next.type;
    setNodes((nds) => nds.map((n) => (n.id === TRIGGER_NODE_ID ? { ...n, data: { ...n.data, label } } : n)));
  }

  // Drawing an edge by dragging from a node's Handle to another node — React
  // Flow's native connect interaction. sourceHandle carries the branch key for a
  // condition node's outgoing edge (the Handle's own id), matching the backend's
  // edge.sourceHandle field directly, no translation needed.
  const onConnect: OnConnect = useCallback((connection) => {
    setEdges((eds) => addEdge({ ...connection, id: newEdgeId(), type: 'smoothstep' }, eds));
  }, [setEdges]);

  // React Flow removes a deleted node from `nodes` on its own (via onNodesChange),
  // but leaves any edge that referenced it dangling in `edges` — clean those up too.
  const onNodesDelete: OnNodesDelete = useCallback((deleted) => {
    const deletedIds = new Set(deleted.map((n) => n.id));
    setEdges((eds) => eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)));
  }, [setEdges]);

  // Explicit delete affordance (NodeConfigPanel's trash icon) — keyboard Backspace
  // already deletes via React Flow's own change/onNodesDelete path above; this
  // mirrors that same edge-cleanup so both paths behave identically.
  function deleteSelectedNode(nodeId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
  }

  function addNode(type: NodeType) {
    const config: NodeConfig =
      type === 'condition'     ? defaultConditionConfig() :
      type === 'send_buttons'  ? defaultSendButtonsConfig() :
      type === 'send_document' ? defaultSendDocumentConfig() :
      type === 'send_message'  ? defaultSendMessageConfig() :
      type === 'send_list'     ? defaultSendListConfig() :
      type === 'send_location' ? defaultSendLocationConfig() :
      type === 'send_flow'     ? defaultSendFlowConfig() :
      type === 'meta_signal'   ? defaultMetaSignalConfig() :
      type === 'send_instagram_message' ? defaultSendInstagramMessageConfig() :
                                  defaultConfig(type as ActionType);
    const newNode: Node<CanvasNodeData> = {
      id: newNodeId(),
      type,
      position: nextNodePosition(nodes),
      data: { nodeType: type, config },
    };
    setNodes((nds) => [...nds, newNode]);
  }

  function handleAutoArrange() {
    setNodes((nds) => applyDagreLayout(nds, edges));
  }

  async function handleSave() {
    if (!onSave) return;

    // Warn, don't block: a condition with a branch that has no outgoing edge saves
    // fine today and only surfaces as a broken execution the first time a real
    // contact takes that branch — flag it up front instead.
    const incomplete = findIncompleteBranches(nodes, edges);
    if (incomplete.length > 0) {
      const summary = incomplete.map((w) => `"${w.nodeLabel}": ${w.missingBranchKeys.join(', ')}`).join('; ');
      toast.warning(`Saved, but some branches have no destination — ${summary}`);
    }

    setSaveState('saving');
    const { nodes: graphNodes, edges: graphEdges, entryNodeId } = fromReactFlow(nodes, edges);
    try {
      await onSave(graphNodes, graphEdges, entryNodeId, trigger);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      setSaveState('idle');
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={onNodesDelete}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'smoothstep', style: { strokeWidth: 2 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} />
          <Controls />
          <MiniMap pannable zoomable className="!bg-white dark:!bg-neutral-900" />
          <Panel position="top-left">
            <NodePalette onAdd={addNode} />
          </Panel>
          <Panel position="top-right">
            <div className="flex items-center gap-2">
              <button
                onClick={handleAutoArrange}
                title="Auto-arrange"
                className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 shadow-sm hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                Auto-arrange
              </button>
              {onSave && (
                <button
                  onClick={handleSave}
                  disabled={saveState === 'saving'}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors',
                    saveState === 'saved' ? 'bg-success-500 text-white' : 'bg-primary-600 text-white hover:bg-primary-700',
                  )}
                >
                  {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> :
                   saveState === 'saved'  ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> :
                                            <Save className="h-3.5 w-3.5" aria-hidden />}
                  {saveState === 'saved' ? 'Saved' : 'Save'}
                </button>
              )}
            </div>
          </Panel>
        </ReactFlow>
      </ReactFlowProvider>

      {selectedNodeId === TRIGGER_NODE_ID ? (
        <TriggerConfigPanel
          trigger={trigger}
          onChange={handleTriggerChange}
          onClose={() => setSelectedNodeId(null)}
          workflowId={workflow.id}
        />
      ) : selectedNode && !NON_CONFIGURABLE.has(String(selectedNode.data.nodeType)) && (
        <NodeConfigPanel
          nodeId={selectedNode.id}
          nodeType={selectedNode.data.nodeType as NodeType}
          config={selectedNode.data.config}
          onChange={updateSelectedConfig}
          onClose={() => setSelectedNodeId(null)}
          onDelete={() => deleteSelectedNode(selectedNode.id)}
        />
      )}
    </div>
  );
}
