import type { NodeTypes } from '@xyflow/react';
import { TriggerNode } from './TriggerNode';
import { ActionNode } from './ActionNode';
import { WaitNode } from './WaitNode';
import { ConditionNode } from './ConditionNode';
import { EndNode } from './EndNode';
import { SendButtonsNode } from './SendButtonsNode';
import { SendDocumentNode } from './SendDocumentNode';
import { SendMessageNode } from './SendMessageNode';
import { SendListNode } from './SendListNode';
import { SendLocationNode } from './SendLocationNode';
import { SendFlowNode } from './SendFlowNode';
import { MetaSignalNode } from './MetaSignalNode';
import { SendInstagramMessageNode } from './SendInstagramMessageNode';
import { SendInstagramPrivateReplyNode } from './SendInstagramPrivateReplyNode';
import { WaitInstagramReplyNode } from './WaitInstagramReplyNode';

// Every ActionType except 'wait'/'end' shares the generic ActionNode shell.
export const nodeTypes: NodeTypes = {
  trigger:         TriggerNode,
  send_template:   ActionNode,
  assign_employee: ActionNode,
  change_stage:    ActionNode,
  add_tag:         ActionNode,
  create_task:     ActionNode,
  start_ai_conversation: ActionNode,
  wait:            WaitNode,
  condition:       ConditionNode,
  send_buttons:    SendButtonsNode,
  send_document:   SendDocumentNode,
  send_message:    SendMessageNode,
  send_list:       SendListNode,
  send_location:   SendLocationNode,
  send_flow:       SendFlowNode,
  meta_signal:     MetaSignalNode,
  send_instagram_message: SendInstagramMessageNode,
  send_instagram_private_reply: SendInstagramPrivateReplyNode,
  wait_instagram_reply:         WaitInstagramReplyNode,
  end:             EndNode,
};
