const { z } = require('zod');
const { DOCUMENT_ALLOWED_MIME } = require('./documentConstants');

// Production incident, 2026-07-07: a .strict() schema rejects ANY unrecognized
// key, including DynamoDB's own storage/audit metadata (PK, SK, companyId,
// updatedAt, updatedBy) — fine written into an item, fatal if that same raw
// item is ever handed straight to Schema.parse() on read. This bug was
// dormant since it was introduced (Phase 2A / PR 1, 66de50d) because it only
// throws once a company has actually saved a real record — a first-write for
// any company instantly breaks every subsequent read. Strip these known
// storage-only fields before validating a raw read against a .strict()
// business schema; the schema still correctly rejects any OTHER genuinely
// unexpected field.
//
// 2026-07-09: the same gap resurfaced in whatsapp.js's welcomeConfigSchema/
// workingHoursConfigSchema/oooConfigSchema/delayedResponseConfigSchema GET
// routes — the original 2026-07-07 fix was applied to aiAdmin.js/
// ConversationalAgentService.js only, never swept to other files using this
// same "raw dynamodb.get().Item handed back as a GET response, later
// round-tripped into a .strict() PUT" shape. Now applied to all four routes
// in whatsapp.js (see TECHNICAL_DEBT.md), but a repo-wide check for other
// .strict()-schema consumers with the same pattern has not been done.
const STORAGE_METADATA_KEYS = ['PK', 'SK', 'companyId', 'updatedAt', 'updatedBy'];
function stripStorageMetadata(item) {
  const rest = { ...(item ?? {}) };
  for (const key of STORAGE_METADATA_KEYS) delete rest[key];
  return rest;
}

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

// Settings > AI tab — master switch + per-useCase module toggles (ADR-015 point 13).
const aiConfigSchema = z.object({
  masterEnabled: z.boolean(),
  moduleToggles: z.record(z.string(), z.boolean()).optional(),
}).strict();

// AI Administration (Phase 2A, PR 1) — General tab. Extends CONFIG#CONVAGENT
// (which today is just {enabled}) with 3 additive toggles. All optional with
// no schema-level default (the .default() would only apply when the FIELD is
// omitted from a PUT body — the real backward-compat guarantee is enforced at
// the read site in ConversationalAgentService.js via `!== false`, not here).
const aiAdminGeneralSchema = z.object({
  conversationAgentEnabled: z.boolean(),
  qualificationEnabled: z.boolean(),
  summaryEnabled: z.boolean(),
  crmAutoTransferEnabled: z.boolean(),
  leadScoringEnabled: z.boolean(),
}).strict();

// AI Administration — Conversation tab (CONFIG#CONVPROMPT). Structured,
// bounded fields only — never a free-text system-prompt override, that's
// Prompt Management (PR 2), a deliberately separate, higher-risk surface.
const aiAdminConversationSchema = z.object({
  persona: z.enum(['professional_rm', 'friendly_advisor', 'concise_expert']).default('professional_rm'),
  tone: z.enum(['professional', 'friendly', 'formal', 'casual']).default('professional'),
  languageRules: z.string().max(300).optional().default(''),
  conversationStyle: z.enum(['concise', 'balanced', 'detailed']).default('concise'),
  qualificationRules: z.string().max(500).optional().default(''),
}).strict();

// AI Administration — Future AI Settings tab (CONFIG#AIFUTURE). RAG/embedding/
// search fields are intentionally NOT in this schema yet — no RAG
// infrastructure exists (Phase 2A explicitly defers it), so there is nothing
// real to validate or store for them until that phase starts. temperature is
// hard-capped well under Anthropic's real ceiling and model is an allowlist,
// not a free-text field — see docs/bible/19_DECISION_LOG.md's Phase 2A entry
// for why these are stored but not yet wired into any live AI call.
const aiAdminFutureSchema = z.object({
  customModelSettings: z.object({
    enabled: z.boolean().default(false),
    model: z.enum(['claude-haiku-4-5-20251001', 'claude-sonnet-5']).nullable().default(null),
    temperature: z.number().min(0).max(0.5).nullable().default(null),
  }).strict().default({ enabled: false, model: null, temperature: null }),
}).strict();

// AI Administration — Prompt Management's addendum draft (CONFIG#PROMPTADDENDUM).
// Bounded per the explicit "bounded addendum only" decision — this is a
// free-text field, unlike the enum/bounded Conversation-tab fields, so it's
// gated behind PromptTestService's live-generation test before publish, not
// just this schema. This schema only validates shape (length), never safety.
const promptAddendumDraftSchema = z.object({
  text: z.string().max(1000),
}).strict();

// Phase 2A / PR 3 — Structured Knowledge Center. `triggers` are lowercased
// here (not left to the matching code to normalize inconsistently) since
// they're compared case-insensitively against the customer's message at
// runtime — this is the one place that decides what "the trigger text" is.
// Same "bounded free text, gated behind a live compliance test before
// publish" shape as promptAddendumDraftSchema — shape validation only,
// never a safety check.
const knowledgeEntryDraftSchema = z.object({
  question: z.string().max(200),
  triggers: z.array(z.string().trim().min(1).max(60).transform((t) => t.toLowerCase())).min(1).max(10),
  answer: z.string().max(500),
  category: z.string().max(40).optional(),
}).strict();

// Phase 2A / PR 4 — Document Knowledge's upload-finalize body. Shape
// validation only — the actual safety check (does the content match the
// claimed mimeType) happens server-side in fileSignature.js against the
// real uploaded bytes, not here.
const knowledgeDocumentMetaSchema = z.object({
  documentId: z.string().uuid(),
  s3Key: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  mimeType: z.string().refine((m) => DOCUMENT_ALLOWED_MIME.has(m), { message: 'Unsupported document type' }),
  category: z.string().max(40).optional(),
}).strict();

// "Delayed Response Message" — same enabled/message-content shape as
// welcomeConfigSchema, plus the delay itself.
const delayedResponseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  delayAmount: z.number().int().min(1).max(1440).default(5),
  delayUnit: z.enum(['minutes', 'hours']).default('minutes'),
  messageText: z.string().max(1024).optional().default(''),
}).strict();

// Working Hours (CONFIG#HOURS) + Out of Office (CONFIG#OOO) — Item 2.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const daySchema = z.object({
  closed: z.boolean().default(false),
  open: z.string().regex(HHMM, 'Use HH:MM, 24-hour').default('09:00'),
  close: z.string().regex(HHMM, 'Use HH:MM, 24-hour').default('18:00'),
}).strict();

const DEFAULT_DAY = { closed: false, open: '09:00', close: '18:00' };
const DEFAULT_SCHEDULE = {
  monday: DEFAULT_DAY, tuesday: DEFAULT_DAY, wednesday: DEFAULT_DAY, thursday: DEFAULT_DAY,
  friday: DEFAULT_DAY, saturday: { ...DEFAULT_DAY, closed: true }, sunday: { ...DEFAULT_DAY, closed: true },
};

const workingHoursConfigSchema = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
  schedule: z.object({
    monday: daySchema, tuesday: daySchema, wednesday: daySchema, thursday: daySchema,
    friday: daySchema, saturday: daySchema, sunday: daySchema,
  }).default(DEFAULT_SCHEDULE),
}).strict();

const oooConfigSchema = z.object({
  enabled: z.boolean().default(false),
  messageText: z.string().max(1024).optional().default(''),
}).strict();

// CONFIG#BRANCH# — multi-office branch directory (Item 1c). Used by the Send
// Location canvas node's dropdown and the Inbox composer's "Send Location"
// button — one shared list of saved offices, not per-feature config.
const branchSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  address: z.string().max(300).optional().default(''),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

const addMetricSchema = z.object({
  metric_type: z.enum(['kyc', 'demat', 'mf', 'insurance', 'algo', 'coaching', 'pms', 'pro_insight', 'ltpp']),
  value: z.number().min(0, 'Value cannot be negative').max(999999),
  date: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const registerSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[!@#$%^&*]/, 'Must contain special character'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['admin', 'manager', 'team_lead', 'agent', 'telecaller', 'intern']).default('telecaller'),
  mobileNumber: z.string().regex(/^\d{10}$/, 'Mobile must be exactly 10 digits').optional(),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN (e.g. ABCDE1234F)').optional(),
  aadhaarNumber: z.string().regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits').optional(),
  homeAddress: z.string().max(300, 'Address must be under 300 characters').optional(),
});

const verifyTotpSchema = z.object({
  tempToken: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits')
});

const verifyBackupSchema = z.object({
  tempToken: z.string().min(1),
  email: z.string().email('Invalid email'),
  backupCode: z.string().regex(/^[A-Z0-9]{8}$/i, 'Backup code must be 8 alphanumeric characters')
});

const updateEmployeeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email('Invalid email').optional(),
  mobileNumber: z.string().regex(/^\d{10}$/, 'Mobile must be exactly 10 digits').optional(),
  role: z.enum(['admin', 'manager', 'team_lead', 'agent', 'telecaller', 'intern']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN format').optional(),
  aadhaarNumber: z.string().regex(/^\d{12}$/, 'Aadhaar must be 12 digits').optional(),
  homeAddress: z.string().max(300).optional(),
  teamLeadId: z.string().nullable().optional(), // null = remove assignment
  baseSalary: z.number().min(0).max(1000000).nullable().optional(),
  autoAssignEnabled: z.boolean().optional(),
  autoAssignWeight: z.number().int().min(1).max(10).optional(),
}).strict();

const companySignupSchema = z.object({
  companyName: z.string().min(2, 'Office name must be at least 2 characters').max(100),
  broker: z.string().min(1, 'Select your broker').max(100),
  city: z.string().min(2, 'City must be at least 2 characters').max(100),
  adminName: z.string().min(2, 'Name must be at least 2 characters').max(100),
  adminEmail: z.string().email('Invalid email'),
  adminMobile: z.string().regex(/^\d{10}$/, 'Mobile must be exactly 10 digits').optional(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
});

const VALID_SOURCES = ['manual', 'import', 'whatsapp', 'referral', 'website', 'facebook', 'instagram', 'whatsapp_ai', 'walk_in', 'social', 'webinar'];

const createLeadSchema = z.object({
  name: z.string().min(1, 'Name required').max(100).trim(),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  email: z.string().email().optional().nullable(),
  source: z.enum(VALID_SOURCES).default('manual'),
  notes: z.string().max(2000).optional().default(''),
  stage: z.string().max(50).optional(),
  tags: z.array(z.string().max(100)).max(20).optional().default([]),
  assignedTo: z.string().optional(),
  assignedToName: z.string().max(100).optional(),
  closureDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  productInterest: z.array(z.string().max(50)).max(10).optional().default([]),
});

const updateLeadSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  email: z.string().email().optional().nullable(),
  productInterest: z.array(z.string().max(50)).max(10).optional(),
  source: z.enum(VALID_SOURCES).optional(),
  notes: z.string().max(2000).optional(),
  closureDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  tags: z.array(z.string().max(100)).max(20).optional(),
}).strict();

const createFollowupSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  note: z.string().max(500).optional().default(''),
});

// ── Welcome-message config (CONFIG#WELCOME) ─────────────────────────────────
// Meta platform rules encoded here: reply buttons (max 3, 20-char titles, no
// emoji) and CTA buttons cannot be combined in one WhatsApp message, so
// messageType is mutually exclusive with which of buttons[]/ctaButtons[] may
// be non-empty — enforced below via superRefine, not left to the frontend.
//
// ctaButtons is scoped to a single URL button (Meta's freeform, non-template
// interactive API — what WhatsAppSendService.sendInteractive() sends — only
// supports one `cta_url` action per message; there is no phone-number CTA
// button outside a pre-approved message template, a different send mechanism
// this codebase doesn't use for welcome messages).
const NO_EMOJI_RE = /\p{Extended_Pictographic}/u;

const welcomeButtonFollowUpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('text'),
    content: z.object({ message: z.string().min(1).max(1000) }),
  }),
  z.object({
    type: z.literal('image'),
    content: z.object({
      mediaId: z.string().optional(),
      url: z.string().url().optional(),
      caption: z.string().max(1000).optional(),
    }).refine((c) => !!(c.mediaId || c.url), { message: 'mediaId or url required for an image follow-up' }),
  }),
  z.object({
    type: z.literal('url_button'),
    content: z.object({
      message: z.string().min(1).max(1000),
      buttonText: z.string().min(1).max(20),
      url: z.string().url(),
    }),
  }),
  z.object({
    type: z.literal('flow'),
    content: z.object({ flowId: z.string().min(1) }),
  }),
]);

const welcomeReplyButtonSchema = z.object({
  id: z.string().min(1).max(50),
  title: z.string().min(1).max(20)
    .refine((t) => !NO_EMOJI_RE.test(t), { message: 'Button title cannot contain emoji (Meta rule)' }),
  followUp: welcomeButtonFollowUpSchema.default({ type: 'none' }),
});

const welcomeCtaButtonSchema = z.object({
  type: z.literal('url'),
  text: z.string().min(1).max(20),
  value: z.string().url(),
});

const welcomeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  messageType: z.enum(['template', 'reply_buttons', 'cta_buttons']).default('template'),
  templateName: z.string().max(200).optional().default(''),
  language: z.string().max(10).optional().default('en'),
  bodyText: z.string().max(1024).optional().default(''),
  buttons: z.array(welcomeReplyButtonSchema).max(3).optional().default([]),
  ctaButtons: z.array(welcomeCtaButtonSchema).max(1).optional().default([]),
}).superRefine((data, ctx) => {
  if (data.messageType === 'reply_buttons') {
    if (data.ctaButtons.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ctaButtons'], message: 'ctaButtons must be empty when messageType is reply_buttons — Meta does not allow combining reply buttons and CTA buttons in one message' });
    }
    if (data.buttons.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buttons'], message: 'At least one button is required when messageType is reply_buttons' });
    }
    if (new Set(data.buttons.map((b) => b.id)).size !== data.buttons.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buttons'], message: 'Button ids must be unique' });
    }
    if (!data.bodyText.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bodyText'], message: 'bodyText is required when messageType is reply_buttons' });
    }
  }
  if (data.messageType === 'cta_buttons') {
    if (data.buttons.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buttons'], message: 'buttons must be empty when messageType is cta_buttons — Meta does not allow combining reply buttons and CTA buttons in one message' });
    }
    if (data.ctaButtons.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ctaButtons'], message: 'At least one CTA button is required when messageType is cta_buttons' });
    }
    if (!data.bodyText.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bodyText'], message: 'bodyText is required when messageType is cta_buttons' });
    }
  }
  if (data.messageType === 'template' && (data.buttons.length > 0 || data.ctaButtons.length > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['messageType'], message: 'buttons/ctaButtons must be empty when messageType is template' });
  }
});

module.exports = {
  loginSchema,
  stripStorageMetadata,
  aiConfigSchema,
  aiAdminGeneralSchema,
  aiAdminConversationSchema,
  aiAdminFutureSchema,
  promptAddendumDraftSchema,
  knowledgeEntryDraftSchema,
  knowledgeDocumentMetaSchema,
  delayedResponseConfigSchema,
  workingHoursConfigSchema,
  oooConfigSchema,
  branchSchema,
  addMetricSchema,
  registerSchema,
  verifyTotpSchema,
  verifyBackupSchema,
  updateEmployeeSchema,
  companySignupSchema,
  createLeadSchema,
  updateLeadSchema,
  createFollowupSchema,
  welcomeConfigSchema,
};
