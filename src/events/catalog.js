'use strict';

/**
 * Canonical event type constants.
 *
 * Every module that calls publishEvent() MUST use these constants.
 * Never pass a raw string — constants catch typos at require-time.
 *
 * Sections marked "Phase 2" / "Phase 3" are reserved — the constants
 * exist now so future modules don't choose conflicting names.
 */
const E = {
  // ── Contact ──────────────────────────────────────────────────────────────
  CONTACT_CREATED:              'contact_created',
  CONTACT_UPDATED:              'contact_updated',
  CONTACT_MERGED:               'contact_merged',
  CONTACT_ARCHIVED:             'contact_archived',
  CONTACT_BLOCKED:              'contact_blocked',
  ACCOUNT_LINKED:               'account_linked',       // Phase 2

  // ── Conversation ─────────────────────────────────────────────────────────
  CONVERSATION_CREATED:         'conversation_created',
  CONVERSATION_ASSIGNED:        'conversation_assigned',
  CONVERSATION_RESOLVED:        'conversation_resolved',
  CONVERSATION_REOPENED:        'conversation_reopened',
  CONVERSATION_SNOOZED:         'conversation_snoozed',  // Phase 2
  INTENT_DETECTED:              'intent_detected',        // Phase 2 (AI)
  PRIORITY_CHANGED:             'priority_changed',
  LABEL_ADDED:                  'label_added',
  LABEL_REMOVED:                'label_removed',
  SLA_BREACHED:                 'sla_breached',           // Phase 2

  // ── Message ───────────────────────────────────────────────────────────────
  MESSAGE_RECEIVED:             'message_received',
  MESSAGE_SENT:                 'message_sent',
  MESSAGE_DELIVERED:            'message_delivered',
  MESSAGE_READ:                 'message_read',
  MESSAGE_FAILED:               'message_failed',
  NOTE_ADDED:                   'note_added',

  // ── Lead ──────────────────────────────────────────────────────────────────
  LEAD_CREATED:                 'lead_created',
  LEAD_UPDATED:                 'lead_updated',
  STAGE_CHANGED:                'stage_changed',
  LEAD_ASSIGNED:                'lead_assigned',
  LEAD_CONVERTED:               'lead_converted',
  LEAD_DELETED:                 'lead_deleted',
  LEAD_RESTORED:                'lead_restored',
  FOLLOWUP_CREATED:             'followup_created',
  FOLLOWUP_COMPLETED:           'followup_completed',

  // ── Customer Journey (Phase 2) ────────────────────────────────────────────
  // Fired by CustomerIdentityService on every resolveOrCreate() call.
  // Recorded once per touch regardless of create vs. enrich.
  TOUCH_RECEIVED:               'touch_received',

  // ── Task (Phase 2) ────────────────────────────────────────────────────────
  TASK_CREATED:                 'task_created',
  TASK_COMPLETED:               'task_completed',
  TASK_OVERDUE:                 'task_overdue',
  TASK_REASSIGNED:              'task_reassigned',

  // ── Campaign ──────────────────────────────────────────────────────────────
  CAMPAIGN_CREATED:             'campaign_created',
  CAMPAIGN_SENT:                'campaign_sent',
  CAMPAIGN_REPLY_RECEIVED:      'campaign_reply_received',

  // ── Workflow (Phase 3) ────────────────────────────────────────────────────
  WORKFLOW_TRIGGERED:           'workflow_triggered',
  WORKFLOW_STEP_EXECUTED:       'workflow_step_executed',
  WORKFLOW_COMPLETED:           'workflow_completed',
  WORKFLOW_FAILED:              'workflow_failed',

  // ── AI (Phase 2) ─────────────────────────────────────────────────────────
  AI_SUMMARY_GENERATED:         'ai_summary_generated',
  AI_INTENT_DETECTED:           'ai_intent_detected',
  AI_SUGGESTION_OFFERED:        'ai_suggestion_offered',

  // ── Document (Phase 2) ────────────────────────────────────────────────────
  DOCUMENT_UPLOADED:            'document_uploaded',
  DOCUMENT_SHARED:              'document_shared',

  // ── Account (Phase 2) ────────────────────────────────────────────────────
  ACCOUNT_CREATED:              'account_created',
  ACCOUNT_UPDATED:              'account_updated',
  CONTACT_ADDED_TO_ACCOUNT:     'contact_added_to_account',
  CONTACT_REMOVED_FROM_ACCOUNT: 'contact_removed_from_account',
};

/**
 * Entity type tokens — used in the Timeline PK:
 *   TL#${companyId}#${ENTITY.CONTACT}#${contactId}
 *   TL#${companyId}#${ENTITY.LEAD}#${leadId}
 *   ...
 */
const ENTITY = {
  CONTACT:  'CONTACT',
  CONV:     'CONV',
  LEAD:     'LEAD',
  ACCOUNT:  'ACCOUNT',   // Phase 2
  CAMPAIGN: 'CAMPAIGN',
  WORKFLOW: 'WORKFLOW',  // Phase 3
  COMPANY:  'COMPANY',
};

module.exports = { E, ENTITY };
