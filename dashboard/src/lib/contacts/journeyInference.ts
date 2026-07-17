import type { ContactDetail } from './types';
import type { PipelineStage } from '@/hooks/usePipelineStages';

export type JourneyStepId =
  | 'source'
  | 'conversation'
  | 'lead'
  | 'meeting'
  | 'proposal'
  | 'won'
  | 'retention'
  | 'referral';

export type JourneyStepState = 'complete' | 'active' | 'future';

export interface JourneyStep {
  id: JourneyStepId;
  label: string;
  state: JourneyStepState;
  date?: string;
}

type ContactForJourney = Pick<
  ContactDetail,
  'stage' | 'createdAt' | 'messageCount' | 'milestones'
>;

/**
 * 2026-07-09 port (docs/phase3/TECHNICAL_DEBT.md): the original Proposal/Won
 * detection matched `contact.stage` against a hardcoded name Set
 * (`proposal`, `negotiation`, `won`, `closed`, `converted`) — none of which
 * exist in the actual pipeline (`PipelineService.DEFAULT_STAGES`: new_lead,
 * contacted, interested, kyc_done, demat_done, lost). Proposal/Won could
 * never become reachable for any company on the default pipeline, and a
 * company with a genuinely custom pipeline wouldn't necessarily use those
 * names either — a stage-name Set can never track an arbitrary, per-company
 * ordered list.
 *
 * Fixed to be ORDER-aware instead of name-aware, reusing the exact
 * `positiveStages`/`maxOrder` convention `LeadScoringService._stagePoints()`
 * already established for "how far along the pipeline is this lead," so the
 * two don't drift into two different definitions of pipeline progress:
 * "lost" is excluded from the ordering (its `order` is highest but means
 * nothing about progress), Won = the current stage IS the highest-order
 * non-lost stage, Proposal = the current stage is at or past the
 * second-highest order. A lost lead never counts as having reached Proposal
 * or Won, regardless of which stage it was in before being marked lost —
 * this codebase has no signal for "how far had it gotten," and crediting
 * progress for a dead deal would overstate it.
 *
 * Stage 3 (2026-07-17 360° audit): "lost" identification itself is now
 * flag-based (`stage.isLost`) instead of a hardcoded key match. A stage's
 * `isLost` flag is opt-in per company (Pipeline Stage Manager); until
 * configured, no stage is excluded here, including a literally
 * `'lost'`-keyed stage.
 *
 * Stage 3 continued (2026-07-17, adversarial-review follow-up): Won
 * detection is ALSO now flag-based once a company has configured any
 * stage's `isWon` — it no longer assumes the highest-order non-lost stage
 * is the won one. Without this, the Sales KPI header (already purely
 * flag-based) and this journey timeline could visibly disagree: e.g.
 * viir_trading's real pipeline has `active_clients` at order 4 but
 * `insurance` at order 7 as the highest non-lost stage once `churned` is
 * flagged `isLost` — a converted customer sitting in `active_clients`
 * would show `reachedWon: false` here while the KPI header correctly
 * counted them as Converted. The order heuristic remains the fallback for
 * an unconfigured pipeline (no stage has `isWon` set anywhere), where
 * there is no flag signal to defer to.
 */
function pipelineProgress(stage: string, stages: PipelineStage[]): { reachedProposal: boolean; reachedWon: boolean } {
  if (!stage) return { reachedProposal: false, reachedWon: false };
  const currentStageObj = stages.find((s) => s.key === stage);
  if (currentStageObj?.isLost) return { reachedProposal: false, reachedWon: false };

  const positiveStages = stages.filter((s) => !s.isLost);
  if (positiveStages.length === 0) return { reachedProposal: false, reachedWon: false };

  const maxOrder = Math.max(...positiveStages.map((s) => s.order));
  const current = positiveStages.find((s) => s.key === stage);
  if (!current) return { reachedProposal: false, reachedWon: false };

  const anyStageConfiguredWon = stages.some((s) => s.isWon);
  const reachedWon = anyStageConfiguredWon ? Boolean(current.isWon) : current.order >= maxOrder;

  return {
    reachedProposal: current.order >= maxOrder - 1,
    reachedWon,
  };
}

/**
 * Pure function — no React dependencies, fully testable.
 *
 * `stages` is the company's real pipeline (`usePipelineStages()` /
 * `useCustomer360().stages`) — required so Proposal/Won can be computed
 * against actual stage order instead of a stale hardcoded name list (see
 * `pipelineProgress()`'s own comment).
 *
 * Meeting/Retention/Referral read `contact.milestones`, a field marked
 * "Reserved — Phase 2 Customer Journey" in `lib/contacts/types.ts` — no
 * backend write path sets it yet (confirmed by repo-wide grep during this
 * port). Those three steps will show `state: 'future'` for every contact
 * until that phase ships; this is accurate (nothing has been recorded), not
 * a bug, and is out of scope for this frontend-only port.
 */
export function inferJourney(contact: ContactForJourney, stages: PipelineStage[]): JourneyStep[] {
  const stage = contact.stage ?? '';
  const { reachedProposal, reachedWon } = pipelineProgress(stage, stages);

  // Ordered completion flags — true means the step has been reached
  const flags: boolean[] = [
    true,                                                    // source — always reached
    (contact.messageCount ?? 0) > 0,                        // conversation
    !!stage,                                                 // lead — has a CRM stage
    !!contact.milestones?.meeting,                          // meeting
    reachedProposal,                                         // proposal
    reachedWon,                                              // won
    !!contact.milestones?.retention,                        // retention
    !!contact.milestones?.referral,                         // referral
  ];

  const stepDefs: { id: JourneyStepId; label: string; date?: string }[] = [
    { id: 'source',       label: 'Source',    date: contact.createdAt },
    { id: 'conversation', label: 'Convo' },
    { id: 'lead',         label: 'Lead' },
    { id: 'meeting',      label: 'Meeting',   date: contact.milestones?.meeting?.date },
    { id: 'proposal',     label: 'Proposal' },
    { id: 'won',          label: 'Won' },
    { id: 'retention',    label: 'Retention', date: contact.milestones?.retention?.date },
    { id: 'referral',     label: 'Referral',  date: contact.milestones?.referral?.date },
  ];

  // The rightmost complete step is labelled "active"
  let activeIdx = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) activeIdx = i;
  }

  return stepDefs.map((def, i): JourneyStep => {
    let state: JourneyStepState;
    if (i === activeIdx) state = 'active';
    else if (flags[i]) state = 'complete';
    else state = 'future';
    return { ...def, state };
  });
}
