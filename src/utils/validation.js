const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

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

module.exports = {
  loginSchema,
  addMetricSchema,
  registerSchema,
  verifyTotpSchema,
  verifyBackupSchema,
  updateEmployeeSchema,
  companySignupSchema,
  createLeadSchema,
  updateLeadSchema,
  createFollowupSchema,
};
