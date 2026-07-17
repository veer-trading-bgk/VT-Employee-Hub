// ── Flow Builder data model (Phase 2a) ────────────────────────────────────────
// Editor-side model + (de)serialization for the in-app WhatsApp Flow screen
// builder (docs/phase2/FUTURE_EXTENSIONS.md §13). Frontend-only in Phase 2a;
// Phase 2b hands toFlowJson() output to the FlowManagementService routes.
//
// Every component carries an editor-local `id` used for React keys and
// dnd-kit sortable identity. It is NOT part of Meta's Flow JSON, so round-trip
// losslessness is defined at the JSON level:
//   toFlowJson(fromFlowJson(json)) deep-equals json
// for any json this builder itself produced. fromFlowJson is NOT a general
// parser for arbitrary externally-authored Flow JSON (that's a later phase) —
// it throws a descriptive error on component types this builder doesn't own.

// ── Meta platform limits — verified constraints, not app config ──────────────
export const FLOW_LIMITS = {
  /** Max components on one screen. */
  maxComponentsPerScreen: 50,
  /** Max chars for a form component's `label` (TextInput, Dropdown, …). */
  componentLabelMax: 20,
  /** Max chars for the Footer CTA `label`. */
  footerLabelMax: 20,
  /** Max chars for a data-source option `title` (Dropdown/Radio/Checkbox). */
  optionTitleMax: 30,
} as const;

/** Flow JSON spec version emitted by toFlowJson (single point of change). */
export const FLOW_JSON_VERSION = '7.0';

// ── Component types ───────────────────────────────────────────────────────────

export type FlowComponentType =
  | 'TextHeading'
  | 'TextSubheading'
  | 'TextBody'
  | 'TextCaption'
  | 'TextInput'
  | 'TextArea'
  | 'Dropdown'
  | 'RadioButtonsGroup'
  | 'CheckboxGroup'
  | 'OptIn'
  | 'DatePicker'
  | 'PhotoPicker'
  | 'Footer';

interface FlowComponentBase {
  /** Editor-local key (React / dnd-kit). Never serialized to Flow JSON. */
  id: string;
}

export interface TextHeadingComponent extends FlowComponentBase {
  type: 'TextHeading';
  text: string;
}

export interface TextSubheadingComponent extends FlowComponentBase {
  type: 'TextSubheading';
  text: string;
}

export interface TextBodyComponent extends FlowComponentBase {
  type: 'TextBody';
  text: string;
}

export interface TextCaptionComponent extends FlowComponentBase {
  type: 'TextCaption';
  text: string;
}

export type TextInputType = 'text' | 'number' | 'email' | 'password' | 'passcode' | 'phone';

export interface TextInputComponent extends FlowComponentBase {
  type: 'TextInput';
  /** Response field name — keys the value in the Flow response payload. */
  name: string;
  label: string;
  inputType: TextInputType;
  required: boolean;
  helperText?: string;
}

export interface TextAreaComponent extends FlowComponentBase {
  type: 'TextArea';
  name: string;
  label: string;
  required: boolean;
  helperText?: string;
}

/** One entry of a selection component's data-source (Meta shape: {id, title}). */
export interface FlowOption {
  id: string;
  title: string;
}

export interface DropdownComponent extends FlowComponentBase {
  type: 'Dropdown';
  name: string;
  label: string;
  required: boolean;
  dataSource: FlowOption[];
}

export interface RadioButtonsGroupComponent extends FlowComponentBase {
  type: 'RadioButtonsGroup';
  name: string;
  label: string;
  required: boolean;
  dataSource: FlowOption[];
}

export interface CheckboxGroupComponent extends FlowComponentBase {
  type: 'CheckboxGroup';
  name: string;
  label: string;
  required: boolean;
  dataSource: FlowOption[];
}

export interface OptInComponent extends FlowComponentBase {
  type: 'OptIn';
  name: string;
  label: string;
  required: boolean;
}

export interface DatePickerComponent extends FlowComponentBase {
  type: 'DatePicker';
  name: string;
  label: string;
  required: boolean;
  helperText?: string;
}

export interface PhotoPickerComponent extends FlowComponentBase {
  type: 'PhotoPicker';
  name: string;
  label: string;
  description?: string;
}

/**
 * Screen CTA. Its on-click-action is derived at serialization time (complete
 * on terminal/last screens, navigate-to-next otherwise) — not editor state.
 */
export interface FooterComponent extends FlowComponentBase {
  type: 'Footer';
  label: string;
}

export type FlowComponent =
  | TextHeadingComponent
  | TextSubheadingComponent
  | TextBodyComponent
  | TextCaptionComponent
  | TextInputComponent
  | TextAreaComponent
  | DropdownComponent
  | RadioButtonsGroupComponent
  | CheckboxGroupComponent
  | OptInComponent
  | DatePickerComponent
  | PhotoPickerComponent
  | FooterComponent;

/** Components that carry a response `name` (everything except text + Footer). */
export type FormFlowComponent =
  | TextInputComponent
  | TextAreaComponent
  | DropdownComponent
  | RadioButtonsGroupComponent
  | CheckboxGroupComponent
  | OptInComponent
  | DatePickerComponent
  | PhotoPickerComponent;

export type SelectionFlowComponent = DropdownComponent | RadioButtonsGroupComponent | CheckboxGroupComponent;

const TEXT_CONTENT_TYPES = new Set<FlowComponentType>(['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption']);

export function isTextContentComponent(
  c: FlowComponent,
): c is TextHeadingComponent | TextSubheadingComponent | TextBodyComponent | TextCaptionComponent {
  return TEXT_CONTENT_TYPES.has(c.type);
}

export function isFormComponent(c: FlowComponent): c is FormFlowComponent {
  return !TEXT_CONTENT_TYPES.has(c.type) && c.type !== 'Footer';
}

export function isSelectionComponent(c: FlowComponent): c is SelectionFlowComponent {
  return c.type === 'Dropdown' || c.type === 'RadioButtonsGroup' || c.type === 'CheckboxGroup';
}

/** Meta allows at most one instance of these per screen. */
export const SINGLETON_COMPONENT_TYPES: ReadonlySet<FlowComponentType> = new Set(['Footer']);

// ── Screen ────────────────────────────────────────────────────────────────────

export interface FlowScreen {
  /** Meta screen id (letters/digits/underscores, e.g. WELCOME). */
  id: string;
  title: string;
  /** Terminal screens complete the Flow; others navigate to the next screen. */
  terminal: boolean;
  components: FlowComponent[];
}

// ── Factories ─────────────────────────────────────────────────────────────────

// Same id idiom as ButtonListEditor's newButtonId — uniqueness within a session.
const newComponentId = () => `fc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
export const newOptionId = () => `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const NAME_BASES: Record<FormFlowComponent['type'], string> = {
  TextInput: 'text_input',
  TextArea: 'text_area',
  Dropdown: 'dropdown',
  RadioButtonsGroup: 'radio_group',
  CheckboxGroup: 'checkbox_group',
  OptIn: 'opt_in',
  DatePicker: 'date',
  PhotoPicker: 'photos',
};

// Response field names must be unique within a screen — suffix past collisions.
function generateComponentName(type: FormFlowComponent['type'], existing: FlowComponent[]): string {
  const taken = new Set(existing.filter(isFormComponent).map((c) => c.name));
  const base = NAME_BASES[type];
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** New component with sensible empty defaults and a screen-unique field name. */
export function createComponent(type: FlowComponentType, existing: FlowComponent[]): FlowComponent {
  const id = newComponentId();
  switch (type) {
    case 'TextHeading':
    case 'TextSubheading':
    case 'TextBody':
    case 'TextCaption':
      return { id, type, text: '' };
    case 'TextInput':
      return { id, type, name: generateComponentName(type, existing), label: '', inputType: 'text', required: false };
    case 'TextArea':
      return { id, type, name: generateComponentName(type, existing), label: '', required: false };
    case 'Dropdown':
    case 'RadioButtonsGroup':
    case 'CheckboxGroup':
      return {
        id,
        type,
        name: generateComponentName(type, existing),
        label: '',
        required: false,
        dataSource: [{ id: newOptionId(), title: '' }],
      };
    case 'OptIn':
      return { id, type, name: generateComponentName(type, existing), label: '', required: false };
    case 'DatePicker':
      return { id, type, name: generateComponentName(type, existing), label: '', required: false };
    case 'PhotoPicker':
      return { id, type, name: generateComponentName(type, existing), label: '' };
    case 'Footer':
      return { id, type, label: 'Continue' };
  }
}

// ── Flow JSON shapes (what Meta's Flow Management API consumes) ───────────────

export type FlowJsonComponent = { type: string } & Record<string, unknown>;

export interface FlowJsonForm {
  type: 'Form';
  name: string;
  children: FlowJsonComponent[];
}

export interface FlowJsonScreen {
  id: string;
  title: string;
  terminal?: true;
  layout: {
    type: 'SingleColumnLayout';
    children: [FlowJsonForm];
  };
}

export interface FlowJson {
  version: string;
  screens: FlowJsonScreen[];
}

// ── Serialization ─────────────────────────────────────────────────────────────

function serializeComponent(c: Exclude<FlowComponent, FooterComponent>): FlowJsonComponent {
  switch (c.type) {
    case 'TextHeading':
    case 'TextSubheading':
    case 'TextBody':
    case 'TextCaption':
      return { type: c.type, text: c.text };
    case 'TextInput':
      return {
        type: c.type,
        name: c.name,
        label: c.label,
        'input-type': c.inputType,
        required: c.required,
        ...(c.helperText !== undefined ? { 'helper-text': c.helperText } : {}),
      };
    case 'TextArea':
    case 'DatePicker':
      return {
        type: c.type,
        name: c.name,
        label: c.label,
        required: c.required,
        ...(c.helperText !== undefined ? { 'helper-text': c.helperText } : {}),
      };
    case 'Dropdown':
    case 'RadioButtonsGroup':
    case 'CheckboxGroup':
      return {
        type: c.type,
        name: c.name,
        label: c.label,
        required: c.required,
        'data-source': c.dataSource.map((o) => ({ id: o.id, title: o.title })),
      };
    case 'OptIn':
      return { type: c.type, name: c.name, label: c.label, required: c.required };
    case 'PhotoPicker':
      return {
        type: c.type,
        name: c.name,
        label: c.label,
        ...(c.description !== undefined ? { description: c.description } : {}),
      };
  }
}

// complete-action payload references the terminal screen's own fields only —
// cross-screen data passing (navigate payloads + screen `data` declarations)
// is Phase 2b, alongside real save/publish.
function serializeFooter(footer: FooterComponent, screen: FlowScreen, screens: FlowScreen[]): FlowJsonComponent {
  const index = screens.indexOf(screen);
  const isLast = index === screens.length - 1;
  if (screen.terminal || isLast) {
    const payload: Record<string, string> = {};
    for (const c of screen.components) {
      if (isFormComponent(c)) payload[c.name] = `\${form.${c.name}}`;
    }
    return { type: 'Footer', label: footer.label, 'on-click-action': { name: 'complete', payload } };
  }
  return {
    type: 'Footer',
    label: footer.label,
    'on-click-action': { name: 'navigate', next: { type: 'screen', name: screens[index + 1].id }, payload: {} },
  };
}

export function toFlowJson(screens: FlowScreen[]): FlowJson {
  return {
    version: FLOW_JSON_VERSION,
    screens: screens.map((screen) => ({
      id: screen.id,
      title: screen.title,
      ...(screen.terminal ? { terminal: true as const } : {}),
      layout: {
        type: 'SingleColumnLayout' as const,
        children: [
          {
            type: 'Form' as const,
            name: `form_${screen.id.toLowerCase()}`,
            children: screen.components.map((c) =>
              c.type === 'Footer' ? serializeFooter(c, screen, screens) : serializeComponent(c),
            ),
          },
        ],
      },
    })),
  };
}

// ── Deserialization ───────────────────────────────────────────────────────────

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function deserializeOptions(value: unknown): FlowOption[] {
  if (!Array.isArray(value)) return [];
  return value.map((o: { id?: unknown; title?: unknown }) => ({ id: asString(o?.id), title: asString(o?.title) }));
}

function deserializeComponent(json: FlowJsonComponent, id: string): FlowComponent {
  switch (json.type) {
    case 'TextHeading':
    case 'TextSubheading':
    case 'TextBody':
    case 'TextCaption':
      return { id, type: json.type, text: asString(json.text) };
    case 'TextInput':
      return {
        id,
        type: json.type,
        name: asString(json.name),
        label: asString(json.label),
        inputType: (asOptionalString(json['input-type']) as TextInputType | undefined) ?? 'text',
        required: json.required === true,
        helperText: asOptionalString(json['helper-text']),
      };
    case 'TextArea':
    case 'DatePicker':
      return {
        id,
        type: json.type,
        name: asString(json.name),
        label: asString(json.label),
        required: json.required === true,
        helperText: asOptionalString(json['helper-text']),
      };
    case 'Dropdown':
    case 'RadioButtonsGroup':
    case 'CheckboxGroup':
      return {
        id,
        type: json.type,
        name: asString(json.name),
        label: asString(json.label),
        required: json.required === true,
        dataSource: deserializeOptions(json['data-source']),
      };
    case 'OptIn':
      return {
        id,
        type: json.type,
        name: asString(json.name),
        label: asString(json.label),
        required: json.required === true,
      };
    case 'PhotoPicker':
      return {
        id,
        type: json.type,
        name: asString(json.name),
        label: asString(json.label),
        description: asOptionalString(json.description),
      };
    case 'Footer':
      return { id, type: 'Footer', label: asString(json.label) };
    default:
      throw new Error(`Unsupported Flow JSON component type: ${String(json.type)}`);
  }
}

export function fromFlowJson(flowJson: FlowJson): FlowScreen[] {
  if (!flowJson || !Array.isArray(flowJson.screens)) {
    throw new Error('Invalid Flow JSON: missing screens array');
  }
  return flowJson.screens.map((screenJson, screenIndex) => {
    const firstChild = screenJson.layout?.children?.[0];
    // This builder always wraps a screen's components in a single Form; accept
    // bare layout children too so hand-tweaked builder output still loads.
    const children: FlowJsonComponent[] =
      firstChild && firstChild.type === 'Form'
        ? firstChild.children
        : ((screenJson.layout?.children ?? []) as unknown as FlowJsonComponent[]);
    return {
      id: screenJson.id,
      title: screenJson.title,
      terminal: screenJson.terminal === true,
      // Deterministic editor ids — regenerated on load, never round-tripped.
      components: children.map((c, i) => deserializeComponent(c, `fc-${screenIndex}-${i}`)),
    };
  });
}
