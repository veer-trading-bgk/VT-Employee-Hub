'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';
import type { PipelineStage } from '../page';

// ── Types ─────────────────────────────────────────────────────────────────────
interface EmployeeRecord { id: string; name: string; role: string; }

interface MappedLead {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  notes?: string;
  tags?: string[];
  productInterest?: string[];
  closureDeadline?: string;
  _row: number;
  _status: 'valid' | 'error' | 'duplicate';
  _error?: string;
}

interface ImportResult {
  imported: number;
  overwritten: number;
  skipped: number;
  errors: { row: number; phone: string; reason: string }[];
}

// ── Constants ────────────────────────────────────────────────────────────────
const LEAD_FIELDS = [
  { key: 'name',            label: 'Name',             required: true },
  { key: 'phone',           label: 'Phone',            required: true },
  { key: 'email',           label: 'Email',            required: false },
  { key: 'source',          label: 'Source',           required: false },
  { key: 'notes',           label: 'Notes',            required: false },
  { key: 'tags',            label: 'Tags (comma-sep)', required: false },
  { key: 'productInterest', label: 'Products',         required: false },
  { key: 'closureDeadline', label: 'Closure Date',     required: false },
];

const AUTO_DETECT: Record<string, string[]> = {
  name:            ['name', 'full name', 'fullname', 'customer', 'client', 'contact', 'person', 'lead name'],
  phone:           ['phone', 'mobile', 'mob', 'contact no', 'ph', 'cell', 'whatsapp', 'number'],
  email:           ['email', 'e-mail', 'mail'],
  source:          ['source', 'lead source', 'channel', 'origin', 'medium'],
  notes:           ['notes', 'note', 'remarks', 'comment', 'description', 'detail'],
  tags:            ['tags', 'tag', 'label', 'category', 'segment'],
  productInterest: ['product', 'products', 'interest', 'service', 'services'],
  closureDeadline: ['deadline', 'closure', 'close date', 'target date', 'due date'],
};

const SOURCES = ['manual', 'referral', 'whatsapp', 'walk_in', 'social', 'webinar', 'import'];
const SAMPLE_CSV = `Name,Phone,Email,Source,Notes,Tags,Products
Rahul Sharma,9876543210,rahul@example.com,referral,Interested in demat,vip,demat
Priya Patel,9123456789,priya@example.com,whatsapp,Called twice,follow-up,kyc
Amit Kumar,8765432109,,social,,priority,mf
`;

// ── CSV Parser ───────────────────────────────────────────────────────────────
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (line[i] === ',' && !inQ) {
        cells.push(cur.trim()); cur = '';
      } else cur += line[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

function autoDetect(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const header of headers) {
    const norm = header.toLowerCase().trim();
    for (const [field, patterns] of Object.entries(AUTO_DETECT)) {
      if (!used.has(field) && patterns.some((p) => norm.includes(p) || p.includes(norm))) {
        mapping[header] = field;
        used.add(field);
        break;
      }
    }
    if (!mapping[header]) mapping[header] = '__skip__';
  }
  return mapping;
}

function buildLeads(headers: string[], rows: string[][], mapping: Record<string, string>): MappedLead[] {
  const phonesInFile = new Set<string>();
  return rows.map((row, idx) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      const field = mapping[h];
      if (field && field !== '__skip__') obj[field] = (row[i] ?? '').trim();
    });

    const name = obj.name?.trim() ?? '';
    const phone = (obj.phone ?? '').replace(/\D/g, '');

    if (!name || phone.length < 7) {
      return { ...obj, name, phone, _row: idx + 2, _status: 'error' as const, _error: !name ? 'Name missing' : 'Phone invalid' };
    }
    if (phonesInFile.has(phone)) {
      return { ...obj, name, phone, _row: idx + 2, _status: 'duplicate' as const, _error: 'Duplicate in this file' };
    }
    phonesInFile.add(phone);

    const tags = obj.tags ? obj.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const productInterest = obj.productInterest ? obj.productInterest.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean) : [];

    return {
      name, phone,
      email: obj.email || undefined,
      source: obj.source || undefined,
      notes: obj.notes || undefined,
      tags: tags.length ? tags : undefined,
      productInterest: productInterest.length ? productInterest : undefined,
      closureDeadline: obj.closureDeadline || undefined,
      _row: idx + 2,
      _status: 'valid' as const,
    };
  });
}

// ── Step indicator ────────────────────────────────────────────────────────────
const STEPS = ['Upload', 'Map Columns', 'Preview', 'Done'];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 px-4 py-5">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all ${
              i < current ? 'bg-indigo-600 text-white' :
              i === current ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 dark:ring-indigo-900' :
              'bg-slate-100 text-slate-400 dark:bg-slate-800'
            }`}>
              {i < current ? '✓' : i + 1}
            </div>
            <span className={`text-[11px] font-medium whitespace-nowrap ${
              i <= current ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'
            }`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`mb-5 h-0.5 w-16 sm:w-24 transition-all ${i < current ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CsvImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [leads, setLeads] = useState<MappedLead[]>([]);
  const [filter, setFilter] = useState<'all' | 'valid' | 'issues'>('all');
  const [config, setConfig] = useState({ defaultStage: '', defaultAssignedTo: '', importTag: '', duplicateAction: 'skip' as 'skip' | 'overwrite' });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importErr, setImportErr] = useState('');

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });
  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 10 * 60_000,
  });

  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) => ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role));

  useEffect(() => {
    if (stages.length && !config.defaultStage) {
      setConfig((c) => ({ ...c, defaultStage: stages[0].key }));
    }
  }, [stages]);

  // ── File handling ──────────────────────────────────────────────────────────
  function processFile(file: File) {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      alert('Please upload a .csv file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) { alert('File too large (max 5 MB)'); return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers: h, rows: r } = parseCSV(e.target?.result as string);
      if (h.length === 0) { alert('CSV appears empty'); return; }
      setHeaders(h);
      setRows(r);
      setMapping(autoDetect(h));
      setStep(1);
    };
    reader.readAsText(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  // ── Proceed to preview ────────────────────────────────────────────────────
  function goPreview() {
    const built = buildLeads(headers, rows, mapping);
    setLeads(built);
    setFilter('all');
    setStep(2);
  }

  // ── Run import ────────────────────────────────────────────────────────────
  async function runImport() {
    setImporting(true);
    setImportErr('');
    try {
      const validLeads = leads.filter((l) => l._status !== 'error');
      const selectedStage = config.defaultStage || stages[0]?.key;
      const assignedEmp = employees.find((e) => e.id === config.defaultAssignedTo);
      const res = await apiFetch<{ success: boolean } & ImportResult>('/api/crm/import', {
        method: 'POST',
        body: JSON.stringify({
          leads: validLeads.map(({ _row, _status, _error, ...l }) => l),
          options: {
            duplicateAction: config.duplicateAction,
            defaultStage: selectedStage,
            defaultAssignedTo: config.defaultAssignedTo || undefined,
            defaultAssignedToName: assignedEmp?.name,
            importTag: config.importTag.trim() || undefined,
          },
        }),
      });
      setResult(res);
      setStep(3);
    } catch (e: any) {
      setImportErr(e?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const valid = leads.filter((l) => l._status === 'valid').length;
  const dupes = leads.filter((l) => l._status === 'duplicate').length;
  const errors = leads.filter((l) => l._status === 'error').length;
  const filteredLeads = leads.filter((l) =>
    filter === 'all' ? true : filter === 'valid' ? l._status === 'valid' : l._status !== 'valid'
  );

  const currentStage = stages.find((s) => s.key === config.defaultStage);
  const nameCol = Object.entries(mapping).find(([, v]) => v === 'name')?.[0];
  const phoneCol = Object.entries(mapping).find(([, v]) => v === 'phone')?.[0];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Navbar title="Import Leads" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-5xl px-4 pb-16">
          <StepBar current={step} />

          {/* ── Step 0: Upload ── */}
          {step === 0 && (
            <div className="mx-auto max-w-xl">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-16 text-center transition-all ${
                  dragging
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/10'
                    : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500'
                }`}
              >
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
                <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition-colors ${dragging ? 'bg-indigo-100 dark:bg-indigo-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                  <span className="text-3xl">📂</span>
                </div>
                <p className="text-base font-semibold text-slate-900 dark:text-white">
                  {dragging ? 'Drop your CSV file here' : 'Drag & drop your CSV file'}
                </p>
                <p className="mt-1.5 text-sm text-slate-400">or click to browse · Max 5 MB · Up to 2,000 leads</p>
                <div className="mt-6 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white">
                  Choose File
                </div>
              </div>

              {/* Sample download */}
              <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Expected format</p>
                <div className="mt-3 overflow-x-auto rounded-lg bg-slate-50 dark:bg-slate-800">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        {['Name *', 'Phone *', 'Email', 'Source', 'Notes', 'Tags', 'Products'].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {['Rahul Sharma', '9876543210', 'rahul@x.com', 'referral', 'Interested', 'vip', 'demat'].map((v, i) => (
                          <td key={i} className="px-3 py-2 text-slate-600 dark:text-slate-300">{v}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() => {
                    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'apforce-leads-sample.csv';
                    a.click();
                  }}
                  className="mt-3 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  ↓ Download sample CSV
                </button>
              </div>
            </div>
          )}

          {/* ── Step 1: Map Columns ── */}
          {step === 1 && (
            <div>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">Map your columns</p>
                  <p className="mt-0.5 text-sm text-slate-400">{fileName} · {rows.length} rows · {headers.length} columns — Auto-detected where possible</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setStep(0)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">← Back</button>
                  <button
                    onClick={goPreview}
                    disabled={!nameCol || !phoneCol}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    Preview →
                  </button>
                </div>
              </div>

              {(!nameCol || !phoneCol) && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-400">
                  ⚠ Map at least <strong>Name</strong> and <strong>Phone</strong> columns to continue.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {headers.map((header) => {
                  const field = mapping[header] ?? '__skip__';
                  const fieldDef = LEAD_FIELDS.find((f) => f.key === field);
                  const samples = rows.slice(0, 3).map((r) => r[headers.indexOf(header)]).filter(Boolean);
                  const isRequired = fieldDef?.required;
                  const isSkipped = field === '__skip__';

                  return (
                    <div key={header} className={`rounded-xl border bg-white p-4 transition-all dark:bg-slate-900 ${
                      isRequired ? 'border-indigo-300 shadow-indigo-50 shadow-sm dark:border-indigo-700'
                      : isSkipped ? 'border-slate-200 opacity-60 dark:border-slate-800'
                      : 'border-slate-200 dark:border-slate-800'
                    }`}>
                      <div className="mb-2.5 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{header}</p>
                        {isRequired && <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:bg-indigo-900/40">Required</span>}
                      </div>

                      {/* Sample values */}
                      <div className="mb-3 space-y-0.5">
                        {samples.length > 0 ? samples.map((s, i) => (
                          <p key={i} className="truncate text-xs text-slate-400">{s}</p>
                        )) : <p className="text-xs italic text-slate-300 dark:text-slate-600">No sample data</p>}
                      </div>

                      <select
                        value={field}
                        onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                        className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-slate-800 dark:text-white ${
                          isRequired ? 'border-indigo-300 text-indigo-700 dark:border-indigo-600 dark:text-indigo-300'
                          : isSkipped ? 'border-slate-200 text-slate-400 dark:border-slate-700'
                          : 'border-slate-200 text-slate-700 dark:border-slate-700'
                        }`}
                      >
                        <option value="__skip__">— Skip this column —</option>
                        {LEAD_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Preview & Configure ── */}
          {step === 2 && (
            <div>
              {/* Stats bar */}
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Rows', val: leads.length, color: 'text-slate-900 dark:text-white', bg: 'bg-white dark:bg-slate-900' },
                  { label: 'Valid', val: valid, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                  { label: 'Duplicates', val: dupes, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                  { label: 'Errors', val: errors, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
                ].map((s) => (
                  <div key={s.label} className={`rounded-xl border border-slate-200 ${s.bg} p-4 dark:border-slate-800`}>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.val}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-4">
                {/* Left: table */}
                <div className="min-w-0 flex-1">
                  {/* Filter tabs */}
                  <div className="mb-3 flex items-center gap-1">
                    {(['all', 'valid', 'issues'] as const).map((f) => (
                      <button key={f} onClick={() => setFilter(f)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                          filter === f ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800'
                        }`}>
                        {f} {f === 'valid' ? `(${valid})` : f === 'issues' ? `(${dupes + errors})` : `(${leads.length})`}
                      </button>
                    ))}
                    <div className="ml-auto flex gap-2">
                      <button onClick={() => setStep(1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">← Remap</button>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60">
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">#</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Name</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phone</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</th>
                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLeads.slice(0, 100).map((lead) => (
                            <tr key={lead._row} className={`border-b last:border-0 dark:border-slate-800 ${
                              lead._status === 'error' ? 'bg-red-50/50 dark:bg-red-900/5'
                              : lead._status === 'duplicate' ? 'bg-amber-50/50 dark:bg-amber-900/5'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}>
                              <td className="px-3 py-2.5 text-xs text-slate-400">{lead._row}</td>
                              <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-white">{lead.name || <span className="italic text-red-400">missing</span>}</td>
                              <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{lead.phone || <span className="italic text-red-400">missing</span>}</td>
                              <td className="max-w-[140px] truncate px-3 py-2.5 text-slate-400">{lead.email ?? '—'}</td>
                              <td className="px-3 py-2.5">
                                {lead._status === 'valid' && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">✓ Valid</span>
                                )}
                                {lead._status === 'duplicate' && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title={lead._error}>⚠ Duplicate</span>
                                )}
                                {lead._status === 'error' && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400" title={lead._error}>✕ {lead._error}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {filteredLeads.length > 100 && (
                      <p className="border-t border-slate-100 p-3 text-center text-xs text-slate-400 dark:border-slate-800">
                        Showing 100 of {filteredLeads.length} rows — all will be imported
                      </p>
                    )}
                    {filteredLeads.length === 0 && (
                      <p className="p-8 text-center text-sm text-slate-400">No rows match this filter.</p>
                    )}
                  </div>
                </div>

                {/* Right: Config panel */}
                <div className="w-64 flex-shrink-0 space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Import Settings</p>

                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Default Stage</label>
                        <select value={config.defaultStage}
                          onChange={(e) => setConfig((c) => ({ ...c, defaultStage: e.target.value }))}
                          style={currentStage ? { borderColor: currentStage.color, color: currentStage.color } : {}}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                          {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Assign to</label>
                        <select value={config.defaultAssignedTo}
                          onChange={(e) => setConfig((c) => ({ ...c, defaultAssignedTo: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                          <option value="">Unassigned</option>
                          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Import Tag</label>
                        <input value={config.importTag}
                          onChange={(e) => setConfig((c) => ({ ...c, importTag: e.target.value }))}
                          placeholder="e.g. june-batch"
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                        <p className="mt-0.5 text-[10px] text-slate-400">Auto-tagged on all imported leads</p>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Duplicates ({dupes} found in file)</label>
                        <div className="flex gap-1">
                          {(['skip', 'overwrite'] as const).map((v) => (
                            <button key={v} onClick={() => setConfig((c) => ({ ...c, duplicateAction: v }))}
                              className={`flex-1 rounded-lg border py-1.5 text-[10px] font-semibold capitalize transition-colors ${
                                config.duplicateAction === v ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800'
                              }`}>
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={runImport}
                    disabled={importing || valid === 0}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-40 dark:shadow-none"
                  >
                    {importing ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Importing…
                      </span>
                    ) : (
                      `Import ${valid + (config.duplicateAction === 'overwrite' ? dupes : 0)} Leads →`
                    )}
                  </button>
                  {importErr && <p className="text-xs text-red-500">{importErr}</p>}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Done ── */}
          {step === 3 && result && (
            <div className="mx-auto max-w-lg text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl dark:bg-emerald-900/30">
                  ✅
                </div>
              </div>

              <h2 className="mb-1 text-2xl font-bold text-slate-900 dark:text-white">Import Complete!</h2>
              <p className="text-sm text-slate-400">Your leads are now in the CRM pipeline.</p>

              <div className="my-8 grid grid-cols-3 gap-4">
                {[
                  { label: 'Imported', val: result.imported, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                  { label: 'Skipped', val: result.skipped + result.overwritten, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                  { label: 'Errors', val: result.errors.length, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
                ].map((s) => (
                  <div key={s.label} className={`rounded-2xl border border-slate-100 ${s.bg} p-5 dark:border-slate-800`}>
                    <p className={`text-3xl font-bold ${s.color}`}>{s.val}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>

              {result.errors.length > 0 && (
                <div className="mb-6 overflow-hidden rounded-xl border border-red-100 bg-white dark:border-red-900/30 dark:bg-slate-900">
                  <p className="border-b border-red-50 px-4 py-2.5 text-xs font-semibold text-red-500 dark:border-red-900/30">Failed rows</p>
                  <div className="max-h-40 overflow-y-auto">
                    {result.errors.map((e) => (
                      <div key={e.row} className="flex items-center justify-between border-b border-slate-50 px-4 py-2 text-xs dark:border-slate-800 last:border-0">
                        <span className="text-slate-400">Row {e.row} · {e.phone}</span>
                        <span className="text-red-400">{e.reason}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const csv = 'Row,Phone,Reason\n' + result.errors.map((e) => `${e.row},${e.phone},"${e.reason}"`).join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = 'import-errors.csv';
                      a.click();
                    }}
                    className="w-full border-t border-slate-50 py-2.5 text-xs font-medium text-indigo-600 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                    ↓ Download error log
                  </button>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setStep(0); setFileName(''); setHeaders([]); setRows([]); setLeads([]); setResult(null); }}
                  className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                  Import Another
                </button>
                <button onClick={() => router.push('/admin/crm')}
                  className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700">
                  View in CRM →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
