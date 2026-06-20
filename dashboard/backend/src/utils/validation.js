const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

const addMetricSchema = z.object({
  metric_type: z.enum(['kyc', 'demat', 'mf', 'insurance', 'revenue', 'algo', 'coaching', 'pms', 'pro_insight', 'ltpp']),
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
  role: z.enum(['admin', 'manager', 'telecaller']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN format').optional(),
  aadhaarNumber: z.string().regex(/^\d{12}$/, 'Aadhaar must be 12 digits').optional(),
  homeAddress: z.string().max(300).optional(),
}).strict();

module.exports = {
  loginSchema,
  addMetricSchema,
  registerSchema,
  verifyTotpSchema,
  verifyBackupSchema,
  updateEmployeeSchema,
};
