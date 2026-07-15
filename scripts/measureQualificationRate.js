'use strict';

/**
 * measureQualificationRate.js — MAX_TURNS 10→5 cost-trial measurement (2026-07-14).
 *
 * STALE AS OF 2026-07-15 (Era 50): MAX_TURNS was raised 5→7 — a qualification-
 * completion decision driven by live conversation evidence, not cost. The 39%
 * baseline, the "revert to 10 if <=29%" trigger, and the whole 10→5 framing
 * below were defined for the earlier 10→5 trial and DO NOT apply to the 5→7
 * change. Do not act on this script's revert trigger as-is; it must be
 * re-baselined against MAX_TURNS=7 before its output means anything. See
 * docs/bible/19_DECISION_LOG.md Era 50.
 *
 * Metric (approved plan, docs/bible/19_DECISION_LOG.md cost-reduction entry):
 *   qualification-completion rate =
 *     (# conversations with any ai_conversation_turn where qualified === true)
 *     ÷ (# conversations that ran >= 1 agent turn)
 *
 * Leading indicator reported alongside:
 *   turn-limit share = (# conversations that hit the cap without qualifying)
 *                      ÷ (total conversations)
 *   — a sharp rise here is the early signal that the tighter cap is cutting
 *   qualifications off before they complete.
 *
 * Window (whichever comes FIRST): the first 50 conversations after --since, OR
 * conversations whose first turn falls within 7 days of --since.
 *
 * Revert trigger (approved): revert MAX_TURNS to 10 if the post-change
 * qualification rate falls to <= 29% (a 10-point absolute drop from the 39%
 * pre-change baseline) OR by >= 25% relative (<= ~29.25%), within the window.
 *
 * Data source: the audit table's `ai_conversation_turn` records (written per
 * turn by ConversationalAgentService._runTurn), which carry
 * details.{conversationId, turnNumber, qualified}. Read-only.
 *
 * Usage:
 *   node scripts/measureQualificationRate.js --since 2026-07-14T00:00:00Z [--max-turns 5] [--baseline 0.39]
 */

require('dotenv').config();
const dynamodb = require('../src/config/dynamodb');
const { MAX_TURNS } = require('../src/services/ConversationalAgentService');

const TABLE = process.env.DYNAMODB_TABLE_AUDIT;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WINDOW_CONV_CAP = 50;
const BASELINE_DEFAULT = 0.39;             // documented pre-change rate (7/18)
const REVERT_ABS_FLOOR = 0.29;             // 10pt absolute drop from 0.39
const REVERT_REL_DROP = 0.25;              // 25% relative drop

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const sinceStr = arg('since', null);
  if (!sinceStr) {
    console.error('ERROR: --since <ISO timestamp> is required (the deploy time of MAX_TURNS=5).');
    process.exit(1);
  }
  const since = new Date(sinceStr).getTime();
  if (Number.isNaN(since)) { console.error(`ERROR: unparseable --since "${sinceStr}"`); process.exit(1); }
  const cap = Number(arg('max-turns', MAX_TURNS));
  const baseline = Number(arg('baseline', BASELINE_DEFAULT));

  // Scan ai_conversation_turn records (audit table has no useCase GSI; a scan
  // is the accepted shape here — same tradeoff as the other one-off audit
  // scripts in this dir, run manually, not on a hot path).
  const items = [];
  let lastKey;
  do {
    const r = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: '#a = :a',
      ExpressionAttributeNames: { '#a': 'action' },
      ExpressionAttributeValues: { ':a': 'ai_conversation_turn' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(r.Items ?? []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  // Group by conversation, tracking first-seen time, qualified, and max turn.
  const convs = new Map();
  for (const it of items) {
    const d = it.details ?? {};
    const convId = d.conversationId ?? it.target;
    if (!convId) continue;
    const ts = new Date(it.timestamp ?? 0).getTime();
    if (ts < since) continue; // only post-deploy turns
    const c = convs.get(convId) ?? { firstSeen: ts, qualified: false, maxTurn: 0 };
    c.firstSeen = Math.min(c.firstSeen, ts);
    if (d.qualified === true) c.qualified = true;
    if (typeof d.turnNumber === 'number') c.maxTurn = Math.max(c.maxTurn, d.turnNumber);
    convs.set(convId, c);
  }

  // Apply the window: first 50 by first-seen, OR within 7 days — whichever fewer.
  const ordered = [...convs.values()].sort((a, b) => a.firstSeen - b.firstSeen);
  const within7d = ordered.filter((c) => c.firstSeen <= since + WINDOW_MS);
  const first50 = ordered.slice(0, WINDOW_CONV_CAP);
  const windowConvs = within7d.length <= first50.length ? within7d : first50;
  const windowBy = within7d.length <= first50.length ? '7-day' : 'first-50';

  const total = windowConvs.length;
  const qualified = windowConvs.filter((c) => c.qualified).length;
  const cappedNoQual = windowConvs.filter((c) => !c.qualified && c.maxTurn >= cap).length;
  const rate = total ? qualified / total : 0;
  const turnLimitShare = total ? cappedNoQual / total : 0;

  const now = Date.now();
  const windowComplete = now >= since + WINDOW_MS || total >= WINDOW_CONV_CAP;

  const revertAbs = rate <= REVERT_ABS_FLOOR;
  const revertRel = rate <= baseline * (1 - REVERT_REL_DROP);
  const revert = total > 0 && (revertAbs || revertRel);

  console.log('── MAX_TURNS=5 qualification-completion measurement ──');
  console.log(`since=${sinceStr}  cap=${cap}  baseline=${(baseline * 100).toFixed(0)}%`);
  console.log(`window: ${windowBy} (${total} conversations, ${windowComplete ? 'COMPLETE' : 'STILL FILLING'})`);
  console.log('');
  console.log(`qualification-completion rate : ${qualified}/${total} = ${(rate * 100).toFixed(1)}%   (baseline ${(baseline * 100).toFixed(0)}%)`);
  console.log(`turn-limit share (leading ind): ${cappedNoQual}/${total} = ${(turnLimitShare * 100).toFixed(1)}%   (conversations that hit the cap unqualified)`);
  console.log('');
  console.log(`revert trigger: <= ${(REVERT_ABS_FLOOR * 100).toFixed(0)}% absolute OR <= ${(baseline * (1 - REVERT_REL_DROP) * 100).toFixed(1)}% (${(REVERT_REL_DROP * 100).toFixed(0)}% relative)`);
  console.log(revert
    ? `  >>> REVERT RECOMMENDED — rate ${(rate * 100).toFixed(1)}% breached the trigger. Restore MAX_TURNS to 10.`
    : total === 0
      ? '  >>> no conversations in window yet — re-run once traffic exists.'
      : `  >>> within tolerance — keep MAX_TURNS=5.${windowComplete ? '' : ' (window not yet complete; re-run at close.)'}`);
}

main().catch((e) => { console.error('measureQualificationRate failed:', e.message); process.exit(1); });
