import type { ContactDetail } from './types';

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

// Stages considered to be at or past "Proposal" in the pipeline
const PROPOSAL_STAGES = new Set(['proposal', 'negotiation', 'won', 'closed', 'converted']);
const WON_STAGES = new Set(['won', 'closed', 'converted']);

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]/g, '');
}

// Pure function — no React dependencies, fully testable
export function inferJourney(contact: ContactForJourney): JourneyStep[] {
  const stage = contact.stage ?? '';

  // Ordered completion flags — true means the step has been reached
  const flags: boolean[] = [
    true,                                                    // source — always reached
    (contact.messageCount ?? 0) > 0,                        // conversation
    !!stage,                                                 // lead — has a CRM stage
    !!contact.milestones?.meeting,                          // meeting
    PROPOSAL_STAGES.has(normalise(stage)),                   // proposal
    WON_STAGES.has(normalise(stage)),                        // won
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
