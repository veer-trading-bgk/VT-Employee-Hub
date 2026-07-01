import type {
  TemplateCategory,
  TemplateStatus,
  QualityScore,
  HeaderFormat,
  ButtonType,
} from './types';

// ── WABA Rules ─────────────────────────────────────────────────────────────────

export const WABA_WINDOW_MS = 24 * 60 * 60 * 1_000;

// ── Character Limits ───────────────────────────────────────────────────────────

export const LIMITS = {
  TEMPLATE_NAME_MAX: 512,
  HEADER_TEXT_MAX: 60,
  BODY_MAX: 1024,
  FOOTER_MAX: 60,
  BUTTON_TEXT_MAX: 25,
  BUTTON_URL_MAX: 2000,
  BUTTON_PHONE_MAX: 20,
  BODY_VARIABLES_MAX: 25,
  HEADER_VARIABLES_MAX: 1,
  BUTTONS_MAX: 3,
  CAROUSEL_CARDS_MIN: 2,
  CAROUSEL_CARDS_MAX: 10,
  CAROUSEL_CARD_BUTTONS_MAX: 2,
  CODE_EXPIRATION_MIN: 1,
  CODE_EXPIRATION_MAX: 90,
} as const;

// ── Template Categories ────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
};

export const CATEGORY_DESCRIPTIONS: Record<TemplateCategory, string> = {
  MARKETING: 'Promotions, offers, announcements, re-engagement',
  UTILITY: 'Order updates, delivery status, account notifications',
  AUTHENTICATION: 'OTPs, login codes, verification, password reset',
};

export const CATEGORY_OPTIONS = (Object.entries(CATEGORY_LABELS) as [TemplateCategory, string][]).map(
  ([value, label]) => ({ value, label }),
);

// ── Template Statuses ──────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<TemplateStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAUSED: 'Paused',
  DISABLED: 'Disabled',
  FLAGGED: 'Flagged',
  IN_APPEAL: 'In Appeal',
  REINSTATED: 'Reinstated',
  PENDING_DELETION: 'Pending Deletion',
};

export const STATUS_DESCRIPTIONS: Record<TemplateStatus, string> = {
  DRAFT: 'Saved locally, not submitted to Meta',
  PENDING: 'Under Meta review (up to 24h)',
  APPROVED: 'Active — ready to send',
  REJECTED: 'Rejected by Meta — review and resubmit',
  PAUSED: 'Temporarily paused due to customer feedback',
  DISABLED: 'Permanently disabled by Meta',
  FLAGGED: 'Quality warning — monitor closely',
  IN_APPEAL: 'Appeal filed — awaiting Meta decision',
  REINSTATED: 'Appeal approved — template reactivated',
  PENDING_DELETION: 'Queued for deletion',
};

// Statuses where the template can be used to send messages
export const SENDABLE_STATUSES: TemplateStatus[] = ['APPROVED', 'REINSTATED'];

// Statuses where template can be edited
export const EDITABLE_STATUSES: TemplateStatus[] = ['DRAFT', 'REJECTED'];

// ── Quality Scores ─────────────────────────────────────────────────────────────

export const QUALITY_LABELS: Record<QualityScore, string> = {
  UNKNOWN: 'No Data',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

// ── Header Formats ─────────────────────────────────────────────────────────────

export const HEADER_FORMAT_LABELS: Record<HeaderFormat | 'NONE', string> = {
  NONE: 'None',
  TEXT: 'Text',
  IMAGE: 'Image',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  LOCATION: 'Location',
};

export const HEADER_FORMAT_OPTIONS: { value: HeaderFormat | 'NONE'; label: string }[] = [
  { value: 'NONE', label: 'None' },
  { value: 'TEXT', label: 'Text' },
  { value: 'IMAGE', label: 'Image' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'DOCUMENT', label: 'Document' },
  { value: 'LOCATION', label: 'Location' },
];

// ── Button Types ───────────────────────────────────────────────────────────────

export const BUTTON_TYPE_LABELS: Record<ButtonType, string> = {
  QUICK_REPLY: 'Quick Reply',
  URL: 'Visit Website',
  PHONE_NUMBER: 'Call Phone',
  OTP: 'One-Time Password',
  FLOW: 'Launch Flow',
  MPM: 'Multi-Product',
  CATALOG: 'View Catalog',
};

export const STANDARD_BUTTON_OPTIONS: { value: ButtonType; label: string }[] = [
  { value: 'QUICK_REPLY', label: 'Quick Reply' },
  { value: 'URL', label: 'Visit Website (URL)' },
  { value: 'PHONE_NUMBER', label: 'Call Phone Number' },
];

// ── Language Codes ─────────────────────────────────────────────────────────────

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'en_GB', label: 'English (UK)' },
  { value: 'hi', label: 'Hindi' },
  { value: 'mr', label: 'Marathi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'bn', label: 'Bengali' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'ur', label: 'Urdu' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt_BR', label: 'Portuguese (Brazil)' },
  { value: 'id', label: 'Indonesian' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'zh_CN', label: 'Chinese (Simplified)' },
  { value: 'zh_TW', label: 'Chinese (Traditional)' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
];

// ── Promotional Word Patterns (for UTILITY category validation) ───────────────

export const PROMOTIONAL_PATTERNS = [
  /\b(sale|offer|discount|deal|promo|coupon|cashback|voucher)\b/i,
  /\b(% off|percent off|flat \d+%)\b/i,
  /\b(free shipping|free delivery|no cost emi)\b/i,
  /\b(limited time|hurry|act now|don'?t miss|exclusive deal)\b/i,
  /\b(buy now|shop now|grab now|order now)\b/i,
];

// ── Spam Signal Patterns ────────────────────────────────────────────────────────

export const SPAM_PATTERNS = [
  /!{3,}/,            // excessive exclamation marks
  /[A-Z]{10,}/,       // long all-caps runs
  /\${2,}/,           // repeated dollar signs
  /(.)\1{5,}/,        // repeated characters (e.g. !!!!!!)
];

// ── Common Rejection Reasons ────────────────────────────────────────────────────

export const REJECTION_REASON_LABELS: Record<string, string> = {
  PROMOTIONAL_WORDING: 'Promotional wording in non-marketing template',
  INVALID_FORMAT: 'Missing variable examples or malformed syntax',
  DUPLICATE_TEMPLATE: 'Similar template already exists in this account',
  POLICY_VIOLATION: 'Content violates WhatsApp Business policy',
  INVALID_BUTTON: 'Button configuration is invalid',
  CATEGORY_MISMATCH: 'Content does not match declared category',
  VARIABLE_COUNT_TOO_HIGH: 'Too many variables (max 25)',
  URL_NOT_HTTPS: 'All URLs must use HTTPS',
  INVALID_LANGUAGE: 'Unsupported language code',
  SPAM_SIGNALS: 'Content triggers spam classifier',
};

// ── Filter options for UI ──────────────────────────────────────────────────────

export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'DISABLED', label: 'Disabled' },
  { value: 'FLAGGED', label: 'Flagged' },
];

export const CATEGORY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Categories' },
  ...CATEGORY_OPTIONS,
];

export const QUALITY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Quality' },
  { value: 'HIGH', label: 'High Quality' },
  { value: 'MEDIUM', label: 'Medium Quality' },
  { value: 'LOW', label: 'Low Quality' },
  { value: 'UNKNOWN', label: 'No Data' },
];
