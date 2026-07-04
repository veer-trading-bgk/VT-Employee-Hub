'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, BackgroundVariant, type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Save, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { nodeTypes } from './nodes';
import { NodeConfigPanel } from './NodeConfigPanel';
import { toReactFlow, fromReactFlow, applyDagreLayout, needsLayout } from '@/lib/automationGraph';
import {
  getTriggerLabel, type Workflow, type GraphNode, type GraphEdge, type NodeConfig, type ActionType,
} from '@/types/automations';

interface WorkflowCanvasProps {
  workflow: Workflow;
  // Omitted entirely (e.g. the checkpoint's blank /canvas/new scaffold) → no Save
  // button renders at all, rather than a Save button that silently does nothing.
  onSave?: (nodes: GraphNode[], edges: GraphEdge[], entryNodeId: string | undefined) => Promise<void>;
}

const NON_CONFIGURABLE = new Set(['trigger', 'end']);

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
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

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

  async function handleSave() {
    if (!onSave) return;
    setSaveState('saving');
    const { nodes: graphNodes, edges: graphEdges, entryNodeId } = fromReactFlow(nodes, edges);
    try {
      await onSave(graphNodes, graphEdges, entryNodeId);
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
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'smoothstep', style: { strokeWidth: 2 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} />
          <Controls />
          <MiniMap pannable zoomable className="!bg-white dark:!bg-neutral-900" />
          {onSave && (
            <Panel position="top-right">
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
            </Panel>
          )}
        </ReactFlow>
      </ReactFlowProvider>

      {selectedNode && !NON_CONFIGURABLE.has(String(selectedNode.data.nodeType)) && (
        <NodeConfigPanel
          nodeId={selectedNode.id}
          nodeType={selectedNode.data.nodeType as ActionType | 'condition'}
          config={selectedNode.data.config}
          onChange={updateSelectedConfig}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
