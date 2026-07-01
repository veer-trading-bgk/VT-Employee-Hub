// ── WhatsApp Template Types ────────────────────────────────────────────────────

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export type TemplateStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'FLAGGED'
  | 'IN_APPEAL'
  | 'REINSTATED'
  | 'PENDING_DELETION';

export type QualityScore = 'UNKNOWN' | 'HIGH' | 'MEDIUM' | 'LOW';

export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

export type ButtonType =
  | 'QUICK_REPLY'
  | 'URL'
  | 'PHONE_NUMBER'
  | 'OTP'
  | 'FLOW'
  | 'MPM'
  | 'CATALOG';

export type OtpType = 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';

export interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phone_number?: string;
  otp_type?: OtpType;
  autofill_text?: string;
  package_name?: string;
  signature_hash?: string;
  flow_id?: string;
  flow_action?: 'navigate' | 'data_exchange';
  navigate_screen?: string;
  example?: string[];    // for dynamic URL variable
}

export interface TemplateVariable {
  position: number;     // 1-based
  example: string;
  description?: string;
}

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | 'CAROUSEL';
  format?: HeaderFormat;           // header only
  text?: string;                   // header (text) / body / footer
  buttons?: TemplateButton[];      // buttons component
  add_security_recommendation?: boolean;  // auth body
  code_expiration_minutes?: number;       // auth footer
  example?: {
    header_text?: string[];
    body_text?: string[][];
    header_handle?: string[];     // for media headers
  };
  cards?: CarouselCard[];          // carousel only
}

export interface CarouselCard {
  components: TemplateComponent[];
}

export interface StatusHistoryEntry {
  from: TemplateStatus | null;
  to: TemplateStatus;
  reason?: string;
  source: 'webhook' | 'manual' | 'api' | 'system';
  at: string; // ISO
}

// The full template record as stored in our DB / returned by the API
export interface WaTemplate {
  id: string;
  companyId: string;

  // Basic metadata (backward-compatible with existing schema)
  name: string;              // display name in APForce
  templateName: string;      // Meta template name (snake_case)
  language: string;          // BCP-47 code e.g. "en_US"
  category: TemplateCategory;
  status: TemplateStatus;
  qualityScore: QualityScore;
  rejectedReason?: string;

  // Full component structure
  components: TemplateComponent[];

  // For backward compat with existing TemplatePicker
  bodyPreview: string;
  variables: string[];

  // Meta integration
  metaTemplateId?: string;
  wabaId?: string;
  allowCategoryChange: boolean;

  // Audit
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;

  // Status history (last 20 entries)
  statusHistory?: StatusHistoryEntry[];

  // Analytics (aggregated)
  analytics?: TemplateAnalytics;
}

export interface TemplateAnalytics {
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  repliedCount: number;
  optOutCount: number;
  deliveryRate: number;    // 0-100
  readRate: number;        // 0-100
  lastUsedAt?: string;
}

// ── Form model used by the create/edit wizard ──────────────────────────────────

export interface TemplateFormValues {
  name: string;
  templateName: string;
  category: TemplateCategory;
  language: string;
  allowCategoryChange: boolean;

  // Header
  headerType: 'NONE' | HeaderFormat;
  headerText: string;
  headerMediaUrl: string;

  // Body
  bodyText: string;
  bodyVariables: Array<{ example: string; description: string }>;

  // Footer
  footerEnabled: boolean;
  footerText: string;

  // Buttons
  buttonsEnabled: boolean;
  buttons: TemplateButtonForm[];

  // Auth-specific
  addSecurityRecommendation: boolean;
  codeExpirationMinutes: number;
}

export interface TemplateButtonForm {
  type: ButtonType;
  text: string;
  url: string;
  isDynamicUrl: boolean;
  dynamicUrlExample: string;
  phoneNumber: string;
  otpType: OtpType;
  autofillText: string;
  packageName: string;
  signatureHash: string;
  flowId: string;
  flowAction: 'navigate' | 'data_exchange';
  navigateScreen: string;
}

// ── API response types ─────────────────────────────────────────────────────────

export interface ListTemplatesResponse {
  success: boolean;
  templates: WaTemplate[];
  total: number;
}

export interface SyncTemplatesResponse {
  success: boolean;
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

export interface SubmitTemplateResponse {
  success: boolean;
  metaTemplateId: string;
  status: TemplateStatus;
}

// ── Validation types ───────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ── Filter / list state ────────────────────────────────────────────────────────

export interface TemplateFilters {
  search: string;
  category: TemplateCategory | '';
  status: TemplateStatus | '';
  language: string;
  qualityScore: QualityScore | '';
}

export const DEFAULT_FILTERS: TemplateFilters = {
  search: '',
  category: '',
  status: '',
  language: '',
  qualityScore: '',
};
