/**
 * One-time migration: converts linear (steps[]) automation workflows to
 * graph shape (nodes[]/edges[]/entryNodeId) — single-editor-migration Fix 3.
 *
 * Converter: each step becomes a node (same id/type/config, unchanged —
 * WorkflowStep.config and GraphNode.config share the exact same StepConfig
 * union in types/automations.ts, confirmed by reading the type file directly;
 * there is no separate linear-vs-graph field vocabulary to map between).
 * Edges connect steps sequentially; entryNodeId is the first step's id.
 *
 * Two phases, run in order, phase 2 only if phase 1 passes clean:
 *
 *   PHASE 1 — EMPIRICAL GATE (zero-loss proof, not an assumption):
 *     Builds a synthetic linear workflow containing every PHASE1_ACTIONS
 *     step type with every field populated, creates it via the real
 *     POST / handler, converts it, saves the conversion via the real
 *     PUT /:id handler (both direct-invocation against REAL AWS, not
 *     mocked — this exercises validateGraphShape() and the actual persist
 *     path, not just the conversion function in isolation), reads it back
 *     via the real GET /:id handler, and diffs every field against the
 *     pre-conversion source. Any mismatch aborts before phase 2 runs.
 *     Runs in an isolated companyId (migration_gate_test) — never touches
 *     real company data — and deletes its own scratch workflow after.
 *
 *   PHASE 2 — REAL CONVERSION:
 *     Only reached if phase 1 is clean. Converts the one actual linear
 *     workflow that exists today ("assign", viir_trading, assign_employee
 *     + end steps — confirmed via a live table scan, 2026-07-10) the same
 *     way, through the same real PUT /:id handler, then re-reads and diffs
 *     it against its own pre-conversion steps[] as final proof.
 *
 * Safe to re-run phase 1 any time (self-contained scratch data, cleaned up
 * after). Phase 2 is idempotent in effect (re-deriving nodes/edges from the
 * same steps[] produces the same result) but has no reason to run twice —
 * steps[] is left in place after conversion (harmless; AutomationEngine and
 * isGraphWorkflow() both dispatch on nodes[] presence, steps[] becoming inert
 * once nodes[] exists), so this is not deleting/rewriting the original data,
 * only adding the graph shape alongside it.
 *
 * Run: node scripts/migrate-linear-to-graph-workflows.js
 */
'use strict';
require('dotenv').config();

process.env.DYNAMODB_TABLE_METRICS = process.env.DYNAMODB_TABLE_METRICS || 'business_metrics';
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

const automationsRouter = require('../src/routes/automations');

function getHandler(path, method) {
  const layer = automationsRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

const postHandler   = getHandler('/', 'post');
const getHandlerFn  = getHandler('/:id', 'get');
const putHandler    = getHandler('/:id', 'put');
const deleteHandler = getHandler('/:id', 'delete');

function mockRes() {
  return {
    _status: 200, _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}
const noopNext = (err) => { if (err) throw err; };

async function callPost(user, body) {
  const res = mockRes();
  await postHandler({ user, body }, res, noopNext);
  if (res._status >= 400) throw new Error(`POST / failed (${res._status}): ${JSON.stringify(res._body)}`);
  return res._body.automation;
}
async function callGet(user, id) {
  const res = mockRes();
  await getHandlerFn({ user, params: { id } }, res, noopNext);
  if (res._status >= 400) throw new Error(`GET /:id failed (${res._status}): ${JSON.stringify(res._body)}`);
  return res._body.automation;
}
async function callPut(user, id, body) {
  const res = mockRes();
  await putHandler({ user, params: { id }, body }, res, noopNext);
  if (res._status >= 400) throw new Error(`PUT /:id failed (${res._status}): ${JSON.stringify(res._body)}`);
  return res._body;
}
async function callDelete(user, id) {
  const res = mockRes();
  await deleteHandler({ user, params: { id } }, res, noopNext);
  if (res._status >= 400) throw new Error(`DELETE /:id failed (${res._status}): ${JSON.stringify(res._body)}`);
}

// ── The converter ────────────────────────────────────────────────────────────
function convertLinearToGraph(steps) {
  const nodes = steps.map((s) => ({ id: s.id, type: s.type, config: s.config }));
  const edges = [];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push({ id: `${steps[i].id}->${steps[i + 1].id}`, source: steps[i].id, target: steps[i + 1].id });
  }
  const entryNodeId = steps[0] && steps[0].id;
  return { nodes, edges, entryNodeId };
}

// ── Field-by-field diff between pre-conversion steps[] and post-conversion nodes[] ──
function diffStepsVsNodes(steps, nodes) {
  const mismatches = [];
  if (steps.length !== nodes.length) {
    mismatches.push(`count mismatch: ${steps.length} steps vs ${nodes.length} nodes`);
    return mismatches;
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const step of steps) {
    const node = nodeById.get(step.id);
    if (!node) { mismatches.push(`step "${step.id}" (${step.type}): no corresponding node found`); continue; }
    if (node.type !== step.type) mismatches.push(`step "${step.id}": type "${step.type}" -> node type "${node.type}"`);
    const stepKeys = Object.keys(step.config || {});
    const nodeKeys = Object.keys(node.config || {});
    for (const k of new Set([...stepKeys, ...nodeKeys])) {
      const a = JSON.stringify((step.config || {})[k]);
      const b = JSON.stringify((node.config || {})[k]);
      if (a !== b) mismatches.push(`step "${step.id}" (${step.type}).config.${k}: ${a} -> ${b}`);
    }
  }
  return mismatches;
}

const SYNTHETIC_STEPS = [
  { id: 'gate-1', type: 'send_template',   config: { templateName: 'welcome_v1', language: 'en', variables: ['{{name}}', '{{phone}}'] } },
  { id: 'gate-2', type: 'assign_employee', config: { employeeId: 'emp_test123', employeeName: 'Test Employee' } },
  { id: 'gate-3', type: 'change_stage',    config: { stage: 'interested' } },
  { id: 'gate-4', type: 'add_tag',         config: { tag: 'hot_lead' } },
  { id: 'gate-5', type: 'create_task',     config: { daysFromNow: 3, note: 'Follow up call' } },
  { id: 'gate-6', type: 'wait',            config: { amount: 15, unit: 'minutes' } },
  { id: 'gate-7', type: 'end',             config: {} },
];

const GATE_USER = { id: 'migration-script', name: 'Migration Script', role: 'admin', companyId: 'migration_gate_test' };

async function runGate() {
  console.log('=== PHASE 1: empirical gate ===');
  const created = await callPost(GATE_USER, {
    name: `GATE-TEST-${Date.now()}`,
    trigger: { type: 'lead_created', conditions: [] },
    steps: SYNTHETIC_STEPS,
    status: 'draft',
  });
  console.log('created scratch workflow', created.id);

  try {
    const { nodes, edges, entryNodeId } = convertLinearToGraph(SYNTHETIC_STEPS);
    if (entryNodeId !== SYNTHETIC_STEPS[0].id) throw new Error(`entryNodeId mismatch: expected ${SYNTHETIC_STEPS[0].id}, got ${entryNodeId}`);
    if (edges.length !== SYNTHETIC_STEPS.length - 1) throw new Error(`edge count mismatch: expected ${SYNTHETIC_STEPS.length - 1}, got ${edges.length}`);

    await callPut(GATE_USER, created.id, { nodes, edges, entryNodeId, trigger: created.trigger });
    const fetched = await callGet(GATE_USER, created.id);

    const mismatches = diffStepsVsNodes(SYNTHETIC_STEPS, fetched.nodes || []);
    if (fetched.entryNodeId !== entryNodeId) mismatches.push(`persisted entryNodeId "${fetched.entryNodeId}" != expected "${entryNodeId}"`);
    if ((fetched.edges || []).length !== edges.length) mismatches.push(`persisted edge count ${(fetched.edges || []).length} != expected ${edges.length}`);

    if (mismatches.length > 0) {
      console.error('GATE FAILED — field loss detected:');
      mismatches.forEach((m) => console.error('  -', m));
      process.exitCode = 1;
      return false;
    }
    console.log('GATE PASSED — all', SYNTHETIC_STEPS.length, 'step types round-tripped with zero field loss.');
    return true;
  } finally {
    await callDelete(GATE_USER, created.id);
    console.log('cleaned up scratch workflow', created.id);
  }
}

async function runRealConversion() {
  console.log('\n=== PHASE 2: real conversion ===');
  const companyId = 'viir_trading';
  const workflowId = 'e1f37fe1-4146-44f4-82ac-fc50846973c3'; // "assign" — confirmed via live table scan
  const user = { id: 'migration-script', name: 'Migration Script', role: 'admin', companyId };

  const before = await callGet(user, workflowId);
  if (!before.steps || before.steps.length === 0) {
    console.log(`workflow ${workflowId} ("${before.name}") has no steps[] — already converted or not linear. Skipping.`);
    return;
  }
  console.log(`converting "${before.name}" (${workflowId}): ${before.steps.length} steps ->`, before.steps.map((s) => s.type).join(', '));

  const { nodes, edges, entryNodeId } = convertLinearToGraph(before.steps);
  await callPut(user, workflowId, { nodes, edges, entryNodeId, trigger: before.trigger });

  const after = await callGet(user, workflowId);
  const mismatches = diffStepsVsNodes(before.steps, after.nodes || []);
  if (after.entryNodeId !== entryNodeId) mismatches.push(`persisted entryNodeId "${after.entryNodeId}" != expected "${entryNodeId}"`);

  if (mismatches.length > 0) {
    console.error('REAL CONVERSION VERIFICATION FAILED:');
    mismatches.forEach((m) => console.error('  -', m));
    process.exitCode = 1;
    return;
  }
  console.log('CONVERTED — nodes:', after.nodes.length, 'edges:', after.edges.length, 'entryNodeId:', after.entryNodeId);
  console.log('name/status/trigger unchanged:',
    after.name === before.name, after.status === before.status, JSON.stringify(after.trigger) === JSON.stringify(before.trigger));
}

async function main() {
  const gateOk = await runGate();
  if (!gateOk) {
    console.error('\nAborting — phase 2 (real conversion) will not run until the gate passes.');
    return;
  }
  await runRealConversion();
}

main().catch((e) => { console.error('MIGRATION SCRIPT ERROR:', e); process.exitCode = 1; });
