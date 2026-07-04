const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

// Settings > AI tab — master switch + per-useCase module toggles (ADR-015 point 13).
const aiConfigSchema = z.object({
  masterEnabled: z.boolean(),
  moduleToggles: z.record(z.string(), z.boolean()).optional(),
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
  aiConfigSchema,
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
