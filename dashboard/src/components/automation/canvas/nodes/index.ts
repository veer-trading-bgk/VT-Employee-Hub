import type { NodeTypes } from '@xyflow/react';
import { TriggerNode } from './TriggerNode';
import { ActionNode } from './ActionNode';
import { WaitNode } from './WaitNode';
import { ConditionNode } from './ConditionNode';
import { EndNode } from './EndNode';

// Every ActionType except 'wait'/'end' shares the generic ActionNode shell.
export const nodeTypes: NodeTypes = {
  trigger:         TriggerNode,
  send_template:   ActionNode,
  assign_employee: ActionNode,
  change_stage:    ActionNode,
  add_tag:         ActionNode,
  create_task:     ActionNode,
  wait:            WaitNode,
  condition:       ConditionNode,
  end:             EndNode,
};
