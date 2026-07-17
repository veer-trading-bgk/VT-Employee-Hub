import {
  AlignLeft,
  Calendar,
  CheckSquare,
  CircleDot,
  FileText,
  Heading1,
  Heading2,
  Image as ImageIcon,
  List,
  PanelBottom,
  Text,
  TextCursorInput,
  ToggleLeft,
} from 'lucide-react';
import type { FlowComponentType } from '@/types/flowBuilder';

// Single source for palette entries, stack-row labels and config-panel titles —
// same role ACTION_META plays for the automation builders.
export const COMPONENT_META: Record<FlowComponentType, { label: string; icon: typeof Heading1 }> = {
  TextHeading: { label: 'Heading', icon: Heading1 },
  TextSubheading: { label: 'Subheading', icon: Heading2 },
  TextBody: { label: 'Body text', icon: AlignLeft },
  TextCaption: { label: 'Caption', icon: Text },
  TextInput: { label: 'Text input', icon: TextCursorInput },
  TextArea: { label: 'Text area', icon: FileText },
  Dropdown: { label: 'Dropdown', icon: List },
  RadioButtonsGroup: { label: 'Radio buttons', icon: CircleDot },
  CheckboxGroup: { label: 'Checkboxes', icon: CheckSquare },
  OptIn: { label: 'Opt-in', icon: ToggleLeft },
  DatePicker: { label: 'Date picker', icon: Calendar },
  PhotoPicker: { label: 'Photo picker', icon: ImageIcon },
  Footer: { label: 'Footer (CTA)', icon: PanelBottom },
};

export const PALETTE_GROUPS: Array<{ label: string; types: FlowComponentType[] }> = [
  { label: 'Text', types: ['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption'] },
  { label: 'Inputs', types: ['TextInput', 'TextArea', 'DatePicker', 'PhotoPicker'] },
  { label: 'Selection', types: ['Dropdown', 'RadioButtonsGroup', 'CheckboxGroup', 'OptIn'] },
  { label: 'Navigation', types: ['Footer'] },
];
