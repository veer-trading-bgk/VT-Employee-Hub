'use strict';

/**
 * testNovaCompliance.js — STANDING pre-deploy compliance gate for the
 * conversational-sales-agent useCase on Nova (established 2026-07-14, Era 46).
 *
 * NOT throwaway: run this before any deploy that changes the Nova model id, the
 * v8 (or later) prompt, or the guardrail logic, and treat any HARD-FAIL across
 * the runs as a release blocker (same bar Era 32 / Era 45 held Claude Haiku to).
 *
 * Runs the EXACT 5-question adversarial compliance suite (PromptTestService's
 * ADVERSARIAL_INPUTS, verbatim) — the same suite Era 32 / Era 45 ran against
 * Claude Haiku 4.5 — against Amazon Nova Lite via the Bedrock Converse API,
 * using the real v8 conversational-sales-agent system prompt and the SAME
 * classifier (violatesGuardrail + isKnownGuaranteeFalsePositive, imported, not
 * reimplemented). RUNS the suite N times, fresh each run. Report-only.
 *
 * Region/profile confirmed 2026-07-14: apac.amazon.nova-lite-v1:0 is reachable
 * from ap-south-1 (no US region / data-residency detour needed).
 *
 * Fair-comparison note: the Claude path sends the whole rendered promptTemplate
 * (question included) as one user message with no separate `system` block. This
 * replicates that exactly, so the comparison is apples-to-apples.
 */

require('dotenv').config();
const AWS = require('aws-sdk');
const { AI_CONFIG } = require('../src/config/aiConfig');
const { violatesGuardrail } = require('../src/services/ConversationalAgentService');
const { ADVERSARIAL_INPUTS, isKnownGuaranteeFalsePositive } = require('../src/services/PromptTestService');

const MODEL_ID = 'apac.amazon.nova-lite-v1:0';
const REGION = 'ap-south-1';
const RUNS = 4;
const cfg = AI_CONFIG['conversational-sales-agent'];

function renderPrompt(question) {
  return cfg.promptTemplate({ latestMessage: question, turnNumber: 1, maxTurns: 5, preferredLanguage: null });
}

async function converse(bedrock, promptText) {
  const t0 = Date.now();
  const resp = await bedrock.converse({
    modelId: MODEL_ID,
    messages: [{ role: 'user', content: [{ text: promptText }] }],
    inferenceConfig: { maxTokens: cfg.maxTokens, temperature: 0.7 },
  }).promise();
  const ms = Date.now() - t0;
  const raw = (resp.output?.message?.content ?? []).map((c) => c.text ?? '').join('');
  return { raw, ms };
}

function extractReply(raw) {
  const m = raw && raw.match(/\{[\s\S]*\}/);
  if (m) { try { const j = JSON.parse(m[0]); if (typeof j.reply === 'string') return { reply: j.reply, json: true }; } catch { /* fall through */ } }
  return { reply: raw ?? '', json: false };
}

function formatDrift(reply) {
  const longestPara = Math.max(0, ...reply.split(/\n+/).map((p) => p.length));
  return longestPara > 350 || (reply.split('\n').filter((l) => l.trim()).length <= 1 && reply.length > 400);
}

async function main() {
  const bedrock = new AWS.BedrockRuntime({ region: REGION });
  console.log(`Model: ${MODEL_ID}   Region: ${REGION}   Prompt: v8 conversational-sales-agent   Runs: ${RUNS}\n`);

  const runSummaries = [];
  const allHardFails = [];
  const allLatencies = [];

  for (let run = 1; run <= RUNS; run++) {
    let clean = 0, knownFP = 0, hardFail = 0, jsonOk = 0, drift = 0;
    for (let i = 0; i < ADVERSARIAL_INPUTS.length; i++) {
      const q = ADVERSARIAL_INPUTS[i];
      const { raw, ms } = await converse(bedrock, renderPrompt(q)); // fresh conversation per question
      allLatencies.push(ms);
      const { reply, json } = extractReply(raw);
      if (json) jsonOk++;
      if (formatDrift(reply)) drift++;
      const tripped = violatesGuardrail(reply);
      const fp = tripped && isKnownGuaranteeFalsePositive(reply);
      if (!tripped) clean++; else if (fp) knownFP++; else { hardFail++; allHardFails.push({ run, q, reply }); }
    }
    runSummaries.push({ run, clean, knownFP, hardFail, jsonOk, drift });
    console.log(`Run ${run}: clean-pass=${clean}  known-FP=${knownFP}  HARD-FAIL=${hardFail}  json=${jsonOk}/5  format-drift=${drift}/5`);
  }

  const totalHardFail = runSummaries.reduce((s, r) => s + r.hardFail, 0);
  const totalJson = runSummaries.reduce((s, r) => s + r.jsonOk, 0);
  const totalDrift = runSummaries.reduce((s, r) => s + r.drift, 0);
  const lat = allLatencies.slice().sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(q / 100 * lat.length))];
  const avg = Math.round(lat.reduce((s, n) => s + n, 0) / lat.length);

  console.log('\n─────────── COMBINED RESULT (all ' + RUNS + ' runs, ' + (RUNS * 5) + ' total turns) ───────────');
  console.log(`HARD-FAIL across ALL runs: ${totalHardFail}   (any > 0 = BLOCKER)`);
  console.log(`JSON-format compliance: ${totalJson}/${RUNS * 5}   |   WhatsApp format-drift: ${totalDrift}/${RUNS * 5}`);
  console.log(`latency (ap-south-1, per turn): avg ${avg} ms  p50 ${p(50)}  p90 ${p(90)}  max ${lat[lat.length - 1]} ms`);
  if (totalHardFail > 0) {
    console.log('\n─────────── HARD-FAIL DETAIL (blocker) ───────────');
    allHardFails.forEach((h, n) => console.log(`\n[${n + 1}] run ${h.run}  Q: ${h.q}\nNova reply (verbatim):\n${h.reply}`));
  } else {
    console.log('\nNo hard-fail in any of the ' + RUNS + ' runs.');
  }
}

main().catch((e) => { console.error('testNovaCompliance failed:', e.message); process.exit(1); });
