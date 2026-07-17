// ── Flow Builder data model (Phase 2a + 2b) ───────────────────────────────────
// Editor-side model + (de)serialization for the in-app WhatsApp Flow screen
// builder (docs/phase2/FUTURE_EXTENSIONS.md §13). toFlowJson() output is what
// PUT /api/whatsapp/flows/builder/:flowId uploads to Meta.
//
// This module stays dependency-free on purpose — it compiles standalone so the
// Node round-trip test suite can exercise it without the Next.js toolchain.
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

// Response field names must be unique across the whole Flow (cross-screen data
// passing keys payloads by name) — suffix past collisions. `reservedNames`
// carries the other screens' field names; `existing` is the current screen's.
function generateComponentName(
  type: FormFlowComponent['type'],
  existing: FlowComponent[],
  reservedNames?: ReadonlySet<string>,
): string {
  const taken = new Set(existing.filter(isFormComponent).map((c) => c.name));
  if (reservedNames) for (const n of reservedNames) taken.add(n);
  const base = NAME_BASES[type];
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** New component with sensible empty defaults and a Flow-unique field name. */
export function createComponent(
  type: FlowComponentType,
  existing: FlowComponent[],
  reservedNames?: ReadonlySet<string>,
): FlowComponent {
  const id = newComponentId();
  switch (type) {
    case 'TextHeading':
    case 'TextSubheading':
    case 'TextBody':
    case 'TextCaption':
      return { id, type, text: '' };
    case 'TextInput':
      return { id, type, name: generateComponentName(type, existing, reservedNames), label: '', inputType: 'text', required: false };
    case 'TextArea':
      return { id, type, name: generateComponentName(type, existing, reservedNames), label: '', required: false };
    case 'Dropdown':
    case 'RadioButtonsGroup':
    case 'CheckboxGroup':
      return {
        id,
        type,
        name: generateComponentName(type, existing, reservedNames),
        label: '',
        required: false,
        dataSource: [{ id: newOptionId(), title: '' }],
      };
    case 'OptIn':
      return { id, type, name: generateComponentName(type, existing, reservedNames), label: '', required: false };
    case 'DatePicker':
      return { id, type, name: generateComponentName(type, existing, reservedNames), label: '', required: false };
    case 'PhotoPicker':
      return { id, type, name: generateComponentName(type, existing, reservedNames), label: '' };
    case 'Footer':
      return { id, type, label: 'Continue' };
  }
}

// ── Screen factory + ID rules ─────────────────────────────────────────────────

/** Meta screen-id shape: letters/digits/underscores, no leading digit. */
export const SCREEN_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** "Confirm Details" → "CONFIRM_DETAILS" (the conventional uppercase form). */
export function deriveScreenId(title: string): string {
  const id = title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!id) return 'SCREEN';
  return /^[0-9]/.test(id) ? `S_${id}` : id;
}

/** Strips characters a screen id can never contain (validation still applies). */
export function sanitizeScreenId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, '');
}

/** New screen with a Flow-unique id and the Footer every screen needs. */
export function createScreen(existing: FlowScreen[]): FlowScreen {
  const taken = new Set(existing.map((s) => s.id));
  let n = existing.length + 1;
  while (taken.has(`SCREEN_${n}`)) n += 1;
  return {
    id: `SCREEN_${n}`,
    title: `Screen ${n}`,
    terminal: false,
    components: [createComponent('Footer', [])],
  };
}

// ── Flow-level validation ─────────────────────────────────────────────────────

export interface FlowValidationIssue {
  level: 'error' | 'warning';
  message: string;
  /** Index into the screens array when the issue is screen-specific. */
  screenIndex?: number;
}

/**
 * Editor-side validation. `error` issues make the Flow JSON structurally
 * broken (or guaranteed-rejected by Meta) and gate Save; `warning` issues
 * surface likely mistakes but leave Meta's own upload validation as the
 * authority. Pure and dependency-free so the Node suite covers it.
 */
export function validateFlow(screens: FlowScreen[]): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  if (screens.length === 0) {
    return [{ level: 'error', message: 'The Flow has no screens.' }];
  }
  if (!screens.some((s) => s.terminal)) {
    issues.push({
      level: 'error',
      message: 'Mark at least one screen as terminal — a terminal screen’s Footer is what completes the Flow.',
    });
  }
  const seenScreenIds = new Set<string>();
  const seenFields = new Map<string, number>(); // field name → screen index of first use
  screens.forEach((screen, i) => {
    if (!SCREEN_ID_PATTERN.test(screen.id)) {
      issues.push({
        level: 'error',
        screenIndex: i,
        message: `Screen ${i + 1} has an invalid ID "${screen.id}" — letters, digits and underscores only, and it cannot start with a digit.`,
      });
    }
    if (seenScreenIds.has(screen.id)) {
      issues.push({ level: 'error', screenIndex: i, message: `Screen ID "${screen.id}" is used by more than one screen.` });
    }
    seenScreenIds.add(screen.id);
    if (screen.components.length === 0) {
      issues.push({ level: 'warning', screenIndex: i, message: `Screen "${screen.id}" is empty.` });
    } else if (!screen.components.some((c) => c.type === 'Footer')) {
      issues.push({
        level: 'warning',
        screenIndex: i,
        message: `Screen "${screen.id}" has no Footer — customers cannot continue or complete from it.`,
      });
    }
    for (const c of screen.components) {
      if (isFormComponent(c)) {
        const firstUse = seenFields.get(c.name);
        if (firstUse === undefined) {
          seenFields.set(c.name, i);
        } else if (firstUse === i) {
          issues.push({ level: 'error', screenIndex: i, message: `Field name "${c.name}" is used twice on screen "${screen.id}".` });
        } else {
          issues.push({
            level: 'error',
            screenIndex: i,
            message: `Field name "${c.name}" is used on screen ${firstUse + 1} and screen ${i + 1} — field names must be unique across the Flow for answers to pass through.`,
          });
        }
      }
      if (isSelectionComponent(c) && c.dataSource.length === 0) {
        issues.push({ level: 'warning', screenIndex: i, message: `"${c.label || c.name}" on screen "${screen.id}" has no options.` });
      }
    }
  });
  // Navigation is linear (each Footer advances to the next screen in order),
  // so anything after the first terminal screen can never be reached.
  const firstTerminal = screens.findIndex((s) => s.terminal);
  if (firstTerminal !== -1 && firstTerminal < screens.length - 1) {
    issues.push({
      level: 'warning',
      screenIndex: firstTerminal,
      message: `Screens after "${screens[firstTerminal].id}" (terminal) will never be reached — move it last, or mark it non-terminal.`,
    });
  }
  return issues;
}

// ── Flow JSON shapes (what Meta's Flow Management API consumes) ───────────────

export type FlowJsonComponent = { type: string } & Record<string, unknown>;

/** One entry of a screen's `data` schema (Meta's cross-screen data channel). */
export interface FlowJsonDataEntry {
  type: string;
  items?: { type: string };
  __example__: unknown;
}

export interface FlowJsonForm {
  type: 'Form';
  name: string;
  children: FlowJsonComponent[];
}

export interface FlowJsonScreen {
  id: string;
  title: string;
  terminal?: true;
  /** Declared shape of what this screen receives from the previous screen. */
  data?: Record<string, FlowJsonDataEntry>;
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

// ── Cross-screen data passing ─────────────────────────────────────────────────
// Meta's mechanism: a screen declares a `data` schema for what it receives
// from the previous screen (referenced as ${data.field}); its own form inputs
// are referenced as ${form.field}. Every navigate payload must carry BOTH
// forward — this screen's answers plus a pass-through of every prior field —
// and the terminal complete payload references the full accumulated set,
// otherwise a multi-screen Flow silently drops earlier screens' answers.
// All of it is derived from component order alone, which is what keeps
// fromFlowJson free to ignore (and toFlowJson to re-derive) it losslessly.

// field name → the component type that produced it. Insertion order gives
// deterministic JSON; a later screen redefining a name overwrites the type,
// matching the ${form.*}-shadows-${data.*} payload semantics below (that
// duplicate is a validateFlow error regardless — this just stays mechanical).
type PriorFields = Map<string, FormFlowComponent['type']>;

function dataSchemaEntryFor(componentType: FormFlowComponent['type']): FlowJsonDataEntry {
  switch (componentType) {
    case 'CheckboxGroup':
      return { type: 'array', items: { type: 'string' }, __example__: ['Example'] };
    case 'PhotoPicker':
      return { type: 'array', items: { type: 'object' }, __example__: [] };
    case 'OptIn':
      return { type: 'boolean', __example__: true };
    default:
      return { type: 'string', __example__: 'Example' };
  }
}

// Prior fields pass through as ${data.*}; the screen's own inputs go out as
// ${form.*} (spread last, so an own field shadows a same-named prior one).
function fieldPayload(screen: FlowScreen, prior: PriorFields): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const name of prior.keys()) payload[name] = `\${data.${name}}`;
  for (const c of screen.components) {
    if (isFormComponent(c)) payload[c.name] = `\${form.${c.name}}`;
  }
  return payload;
}

function serializeFooter(
  footer: FooterComponent,
  screen: FlowScreen,
  screens: FlowScreen[],
  prior: PriorFields,
): FlowJsonComponent {
  const index = screens.indexOf(screen);
  const isLast = index === screens.length - 1;
  if (screen.terminal || isLast) {
    return {
      type: 'Footer',
      label: footer.label,
      'on-click-action': { name: 'complete', payload: fieldPayload(screen, prior) },
    };
  }
  return {
    type: 'Footer',
    label: footer.label,
    'on-click-action': {
      name: 'navigate',
      next: { type: 'screen', name: screens[index + 1].id },
      payload: fieldPayload(screen, prior),
    },
  };
}

export function toFlowJson(screens: FlowScreen[]): FlowJson {
  const prior: PriorFields = new Map();
  return {
    version: FLOW_JSON_VERSION,
    screens: screens.map((screen) => {
      const dataSchema: Record<string, FlowJsonDataEntry> = {};
      for (const [name, componentType] of prior) dataSchema[name] = dataSchemaEntryFor(componentType);
      const screenJson: FlowJsonScreen = {
        id: screen.id,
        title: screen.title,
        ...(screen.terminal ? { terminal: true as const } : {}),
        ...(prior.size > 0 ? { data: dataSchema } : {}),
        layout: {
          type: 'SingleColumnLayout' as const,
          children: [
            {
              type: 'Form' as const,
              name: `form_${screen.id.toLowerCase()}`,
              children: screen.components.map((c) =>
                c.type === 'Footer' ? serializeFooter(c, screen, screens, prior) : serializeComponent(c),
              ),
            },
          ],
        },
      };
      // Merge AFTER serializing: this screen's Footer payload distinguishes its
      // own ${form.*} fields from the ${data.*} pass-through of earlier ones.
      for (const c of screen.components) {
        if (isFormComponent(c)) prior.set(c.name, c.type);
      }
      return screenJson;
    }),
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
    // screenJson.data and the Footer payloads are NOT read back: both are
    // fully derived from component order (see toFlowJson), so which fields a
    // screen receives is reconstructed from where components live — and
    // re-serializing regenerates identical declarations (lossless).
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

// ── Registered-flow row (backend contract) ────────────────────────────────────

/**
 * CONFIG#FLOW# row as returned by GET /api/whatsapp/flows — the shared shape
 * for the Settings panel and the builder workspace. `source`/`status`/`flowJson`
 * exist only on builder-created rows (routes/whatsapp.js POST /flows/builder);
 * register-by-ID rows predate them.
 */
export interface RegisteredFlowRecord {
  flowId: string;
  name: string;
  bodyText: string;
  ctaLabel: string;
  screenId: string | null;
  source?: string;
  status?: string;
  flowJson?: FlowJson | null;
  createdAt: string;
  updatedAt?: string;
}
