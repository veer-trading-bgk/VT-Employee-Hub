import type { TemplateFormValues, ValidationResult, ValidationIssue } from './types';
import {
  LIMITS,
  PROMOTIONAL_PATTERNS,
  SPAM_PATTERNS,
} from './constants';

// ── Helpers ────────────────────────────────────────────────────────────────────

function err(field: string, code: string, message: string): ValidationIssue {
  return { field, code, message, severity: 'error' };
}

function warn(field: string, code: string, message: string): ValidationIssue {
  return { field, code, message, severity: 'warning' };
}

function countVars(text: string): number[] {
  const matches = [...text.matchAll(/\{\{(\d+)\}\}/g)];
  return matches.map((m) => parseInt(m[1]));
}

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Template name: a-z, 0-9, _ only, 1-512 chars
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
// Variable placeholder pattern
const VARIABLE_RE = /\{\{(\d+)\}\}/g;

// ── Main Validation Engine ─────────────────────────────────────────────────────

export function validateTemplate(form: TemplateFormValues): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // ── Name ─────────────────────────────────────────────────────────────────────
  if (!form.templateName.trim()) {
    errors.push(err('templateName', 'REQUIRED', 'Template name is required'));
  } else if (!TEMPLATE_NAME_RE.test(form.templateName)) {
    errors.push(err('templateName', 'INVALID_NAME',
      'Template name must be lowercase letters, numbers and underscores only (no spaces or special chars)'));
  }

  if (!form.name.trim()) {
    errors.push(err('name', 'REQUIRED', 'Display name is required'));
  }

  // ── Category ─────────────────────────────────────────────────────────────────
  if (!form.category) {
    errors.push(err('category', 'REQUIRED', 'Category is required'));
  }

  // ── Language ─────────────────────────────────────────────────────────────────
  if (!form.language) {
    errors.push(err('language', 'REQUIRED', 'Language is required'));
  }

  // ── Authentication templates — body/footer auto-generated, skip text validations
  if (form.category === 'AUTHENTICATION') {
    const hasButtons = form.buttonsEnabled && form.buttons.length > 0;
    if (!hasButtons) {
      errors.push(err('buttons', 'AUTH_BUTTON_REQUIRED',
        'Authentication templates require an OTP button (Copy Code, One-Tap, or Zero-Tap)'));
    } else {
      if (form.buttons.length > 1) {
        errors.push(err('buttons', 'TOO_MANY_AUTH_BUTTONS',
          'Authentication templates must have exactly one button'));
      }
      const otpButton = form.buttons.find((b) => b.type === 'OTP');
      if (!otpButton) {
        errors.push(err('buttons', 'OTP_BUTTON_REQUIRED',
          'Authentication templates must have exactly one OTP button'));
      } else {
        if (!otpButton.text?.trim()) {
          errors.push(err('buttons[0].text', 'REQUIRED', 'OTP button text is required'));
        }
        if (otpButton.otpType === 'ONE_TAP' || otpButton.otpType === 'ZERO_TAP') {
          if (!otpButton.packageName?.trim()) {
            errors.push(err('buttons[0].packageName', 'REQUIRED',
              'Android package name is required for One-Tap and Zero-Tap buttons'));
          }
          if (!otpButton.signatureHash?.trim()) {
            errors.push(err('buttons[0].signatureHash', 'REQUIRED',
              'App signature hash is required for One-Tap and Zero-Tap buttons'));
          }
        }
      }
      if (form.codeExpirationMinutes &&
          (form.codeExpirationMinutes < LIMITS.CODE_EXPIRATION_MIN ||
           form.codeExpirationMinutes > LIMITS.CODE_EXPIRATION_MAX)) {
        errors.push(err('codeExpirationMinutes', 'OUT_OF_RANGE',
          `Code expiration must be between ${LIMITS.CODE_EXPIRATION_MIN} and ${LIMITS.CODE_EXPIRATION_MAX} minutes`));
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  // ── Header ────────────────────────────────────────────────────────────────────
  if (form.headerType === 'TEXT') {
    if (!form.headerText.trim()) {
      errors.push(err('headerText', 'REQUIRED', 'Header text is required when header type is Text'));
    } else if (form.headerText.length > LIMITS.HEADER_TEXT_MAX) {
      errors.push(err('headerText', 'TOO_LONG',
        `Header text is ${form.headerText.length} chars, max ${LIMITS.HEADER_TEXT_MAX}`));
    } else {
      const headerVars = countVars(form.headerText);
      if (headerVars.length > LIMITS.HEADER_VARIABLES_MAX) {
        errors.push(err('headerText', 'TOO_MANY_HEADER_VARS',
          'Header can have at most 1 variable'));
      } else if (headerVars.length > 0 && !form.headerVariableExample?.trim()) {
        errors.push(err('headerVariableExample', 'EXAMPLE_REQUIRED',
          'An example value for {{1}} in the header is required by Meta'));
      }
    }
  } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType)) {
    if (!form.headerMediaUrl.trim()) {
      warnings.push(warn('headerMediaUrl', 'MISSING_MEDIA',
        'No media URL provided — you will need to supply the media ID at send time'));
    }
  }

  // ── Body ──────────────────────────────────────────────────────────────────────
  if (!form.bodyText.trim()) {
    errors.push(err('bodyText', 'REQUIRED', 'Message body is required'));
  } else {
    // Length check
    if (form.bodyText.length > LIMITS.BODY_MAX) {
      errors.push(err('bodyText', 'TOO_LONG',
        `Body is ${form.bodyText.length} chars, max ${LIMITS.BODY_MAX}`));
    }

    // Variable numbering — must be sequential starting at 1
    const vars = countVars(form.bodyText);
    if (vars.length > LIMITS.BODY_VARIABLES_MAX) {
      errors.push(err('bodyText', 'TOO_MANY_VARIABLES',
        `Body has ${vars.length} variables, max is ${LIMITS.BODY_VARIABLES_MAX}`));
    } else if (vars.length > 0) {
      const sorted = [...new Set(vars)].sort((a, b) => a - b);
      const isSequential = sorted.every((v, i) => v === i + 1);
      if (!isSequential) {
        errors.push(err('bodyText', 'VARIABLE_NOT_SEQUENTIAL',
          'Variables must be sequential: {{1}}, {{2}}, {{3}} with no gaps or duplicates'));
      }

      // Each variable must have an example
      for (let i = 0; i < sorted.length; i++) {
        if (!form.bodyVariables[i]?.example?.trim()) {
          errors.push(err(`bodyVariables[${i}].example`, 'EXAMPLE_REQUIRED',
            `Example value for {{${i + 1}}} is required`));
        }
      }
    }

    // Body is entirely variables (no static text) — Meta rejects this
    const strippedBody = form.bodyText.replace(VARIABLE_RE, '').trim();
    if (!strippedBody && vars.length > 0) {
      errors.push(err('bodyText', 'ALL_VARIABLE_BODY',
        'Body cannot consist entirely of variables — add some static text'));
    }

    // Promotional wording in non-marketing templates
    if (form.category !== 'MARKETING') {
      for (const pattern of PROMOTIONAL_PATTERNS) {
        if (pattern.test(form.bodyText)) {
          warnings.push(warn('bodyText', 'PROMOTIONAL_IN_NON_MARKETING',
            'Promotional language detected in a non-MARKETING template — may be rejected or auto-recategorised'));
          break;
        }
      }
    }

    // Spam signals
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(form.bodyText)) {
        warnings.push(warn('bodyText', 'SPAM_SIGNAL',
          'Content may trigger spam classifier — avoid excessive punctuation or ALL CAPS'));
        break;
      }
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  if (form.footerEnabled && form.footerText) {
    if (form.footerText.length > LIMITS.FOOTER_MAX) {
      errors.push(err('footerText', 'TOO_LONG',
        `Footer is ${form.footerText.length} chars, max ${LIMITS.FOOTER_MAX}`));
    }
    if (/\{\{\d+\}\}/.test(form.footerText)) {
      errors.push(err('footerText', 'VARIABLE_IN_FOOTER',
        'Variables are not allowed in the footer'));
    }
  }

  // ── Buttons ───────────────────────────────────────────────────────────────────
  if (form.buttonsEnabled && form.buttons.length > 0) {
    if (form.buttons.length > LIMITS.BUTTONS_MAX) {
      errors.push(err('buttons', 'TOO_MANY_BUTTONS',
        `Standard templates support max ${LIMITS.BUTTONS_MAX} buttons`));
    }

    form.buttons.forEach((btn, i) => {
      const prefix = `buttons[${i}]`;

      if (!btn.text?.trim()) {
        errors.push(err(`${prefix}.text`, 'REQUIRED', `Button ${i + 1} text is required`));
      } else if (btn.text.length > LIMITS.BUTTON_TEXT_MAX) {
        errors.push(err(`${prefix}.text`, 'TOO_LONG',
          `Button ${i + 1} text is ${btn.text.length} chars, max ${LIMITS.BUTTON_TEXT_MAX}`));
      }

      if (btn.type === 'URL') {
        if (!btn.url?.trim()) {
          errors.push(err(`${prefix}.url`, 'REQUIRED', `Button ${i + 1} URL is required`));
        } else {
          if (!isValidUrl(btn.url)) {
            errors.push(err(`${prefix}.url`, 'INVALID_URL', `Button ${i + 1} has an invalid URL`));
          } else if (!isHttpsUrl(btn.url)) {
            errors.push(err(`${prefix}.url`, 'URL_NOT_HTTPS',
              `Button ${i + 1} URL must use HTTPS (required since Jan 1, 2026)`));
          }
          if (btn.url.length > LIMITS.BUTTON_URL_MAX) {
            errors.push(err(`${prefix}.url`, 'URL_TOO_LONG',
              `Button ${i + 1} URL exceeds maximum length of ${LIMITS.BUTTON_URL_MAX} chars`));
          }
          if (btn.isDynamicUrl && !btn.dynamicUrlExample?.trim()) {
            errors.push(err(`${prefix}.dynamicUrlExample`, 'EXAMPLE_REQUIRED',
              `Button ${i + 1} dynamic URL variable requires an example value`));
          }
        }
      }

      if (btn.type === 'PHONE_NUMBER') {
        if (!btn.phoneNumber?.trim()) {
          errors.push(err(`${prefix}.phoneNumber`, 'REQUIRED',
            `Button ${i + 1} phone number is required`));
        } else if (!/^\+\d{7,15}$/.test(btn.phoneNumber.trim())) {
          errors.push(err(`${prefix}.phoneNumber`, 'INVALID_PHONE',
            `Button ${i + 1} phone number must be in E.164 format: +917200000000`));
        }
      }
    });

    // Mixed button types check: quick replies cannot be mixed with CTA buttons per Meta policy
    const hasQuickReply = form.buttons.some((b) => b.type === 'QUICK_REPLY');
    const hasCTA = form.buttons.some((b) => ['URL', 'PHONE_NUMBER'].includes(b.type));
    if (hasQuickReply && hasCTA) {
      errors.push(err('buttons', 'MIXED_BUTTON_TYPES',
        'Quick Reply buttons cannot be mixed with URL/Phone buttons — Meta rejects this combination'));
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Derived helpers ─────────────────────────────────────────────────────────────

export function getBodyPreview(bodyText: string): string {
  return bodyText.slice(0, 100);
}

export function extractVariableCount(bodyText: string): number {
  const vars = countVars(bodyText);
  return vars.length > 0 ? Math.max(...vars) : 0;
}

export function buildVariableLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Variable ${i + 1}`);
}

// Convert form values to component JSON for the API
export function formToComponents(form: TemplateFormValues) {
  if (form.category === 'AUTHENTICATION') {
    return buildAuthComponents(form);
  }
  return buildStandardComponents(form);
}

function buildAuthComponents(form: TemplateFormValues) {
  const components: object[] = [];

  components.push({
    type: 'BODY',
    add_security_recommendation: form.addSecurityRecommendation,
  });

  if (form.codeExpirationMinutes) {
    components.push({
      type: 'FOOTER',
      code_expiration_minutes: form.codeExpirationMinutes,
    });
  }

  if (form.buttonsEnabled && form.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: form.buttons.map((btn) => ({
        type: 'OTP',
        otp_type: btn.otpType,
        text: btn.text,
        ...((btn.otpType === 'ONE_TAP' || btn.otpType === 'ZERO_TAP') && {
          autofill_text: btn.autofillText,
          package_name: btn.packageName,
          signature_hash: btn.signatureHash,
        }),
      })),
    });
  }

  return components;
}

function buildStandardComponents(form: TemplateFormValues) {
  const components: object[] = [];

  // Header
  if (form.headerType !== 'NONE') {
    const header: Record<string, unknown> = { type: 'HEADER', format: form.headerType };
    if (form.headerType === 'TEXT') {
      header.text = form.headerText;
      const vars = countVars(form.headerText);
      if (vars.length > 0) {
        header.example = { header_text: [form.headerVariableExample || ''] };
      }
    } else if (form.headerMediaUrl) {
      header.example = { header_handle: [form.headerMediaUrl] };
    }
    components.push(header);
  }

  // Body
  if (form.bodyText) {
    const body: Record<string, unknown> = { type: 'BODY', text: form.bodyText };
    const varCount = extractVariableCount(form.bodyText);
    if (varCount > 0) {
      body.example = {
        body_text: [form.bodyVariables.slice(0, varCount).map((v) => v.example || '')],
      };
    }
    components.push(body);
  }

  // Footer
  if (form.footerEnabled && form.footerText.trim()) {
    components.push({ type: 'FOOTER', text: form.footerText });
  }

  // Buttons
  if (form.buttonsEnabled && form.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: form.buttons.map((btn) => {
        const b: Record<string, unknown> = { type: btn.type, text: btn.text };
        if (btn.type === 'URL') {
          b.url = btn.isDynamicUrl ? `${btn.url}{{1}}` : btn.url;
          if (btn.isDynamicUrl) b.example = [btn.dynamicUrlExample];
        }
        if (btn.type === 'PHONE_NUMBER') b.phone_number = btn.phoneNumber;
        return b;
      }),
    });
  }

  return components;
}
