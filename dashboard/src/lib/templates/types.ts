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
  status: TemplateStatus;
  ts: string;           // ISO timestamp
  reason: string | null;
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

  // S3 reference for a media (IMAGE/VIDEO/DOCUMENT) HEADER's example, if any.
  // Deliberately NOT resolved into components[].example.header_handle at
  // save time — Meta's Resumable Upload handles expire in ~24h and drafts
  // routinely sit far longer than that. POST /templates/:id/submit resolves
  // this fresh on every submit attempt instead (2026-07-10,
  // docs/phase3/TECHNICAL_DEBT.md).
  headerMediaRef?: TemplateHeaderMediaRef | null;
}

// Matches automation/MediaSourceField.tsx's MediaSourceValue shape
// structurally (not imported directly — lib/templates stays decoupled from
// components/automation; TypeScript's structural typing makes this safe).
export interface TemplateHeaderMediaRef {
  s3Key?:    string;
  mimeType?: string;
  filename?: string;
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
  headerMediaRef: TemplateHeaderMediaRef | null; // submitted value — S3 reference, resolved to a Meta handle server-side at submit time
  headerPreviewUrl: string | null;                // display-only — a presigned GET URL for the WhatsApp-bubble preview, never submitted
  headerVariableExample: string;

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
}

export interface SyncTemplatesResponse {
  success: boolean;
  synced: number;
  imported: number;
  total: number;
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

// ── AI-Assisted Template Creation ───────────────────────────────────────────────
// Shape returned by POST /api/whatsapp/templates/ai-draft — mirrors the
// 'template-creation' useCase's zod schema in src/config/aiConfig.js.
// Deliberately MARKETING | UTILITY only — never AUTHENTICATION (Meta
// auto-generates that body; there's nothing for the AI to draft).

export interface AiTemplateDraftButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface AiTemplateDraft {
  name: string;
  category: 'MARKETING' | 'UTILITY';
  categoryReasoning: string;
  bodyText: string;
  bodyVariables: Array<{ example: string; description: string }>;
  headerText?: string;
  footerText?: string;
  buttons?: AiTemplateDraftButton[];
}

export interface AiTemplateDraftResponse {
  success: boolean;
  draft: AiTemplateDraft;
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
