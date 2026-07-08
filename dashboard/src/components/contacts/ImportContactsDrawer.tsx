'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle, Download as DownloadIcon,
} from 'lucide-react';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { apiFetch, ApiClientError } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';

// ── CSV parser ────────────────────────────────────────────────────────────────
// Handles: quoted fields, embedded commas, escaped quotes, BOM, CRLF

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let inQ = false;
  let cell = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cell += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      cells.push(cell.trim()); cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseCSV(raw: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip BOM if present (common in Excel-exported CSV)
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
    });
  return { headers, rows };
}

// Fuzzy column name matching — handles Name/Full Name/Customer Name/Lead Name etc.
function detectCol(headers: string[], patterns: RegExp[]): string {
  for (const pat of patterns) {
    const match = headers.find((h) => pat.test(h.toLowerCase()));
    if (match) return match;
  }
  return '';
}

const PHONE_PATTERNS  = [/^phone/, /^mobile/, /^contact/, /^number/, /^ph$/, /^mob$/];
const NAME_PATTERNS   = [/^name/, /^full.?name/, /^customer/, /^lead/, /^person/];
const EMAIL_PATTERNS  = [/^email/, /^mail/, /^e.?mail/];

// ── Template download ─────────────────────────────────────────────────────────

function downloadTemplate() {
  const csv = 'Name,Phone,Email\nRahul Sharma,9876543210,rahul@example.com\nPriya Patel,9123456789,';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'contacts_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'importing' | 'done';

interface Detected {
  headers:  string[];
  rows:     Record<string, string>[];
  colPhone: string;
  colName:  string;
  colEmail: string;
  fileName: string;
}

interface ImportRowError {
  row:    number;
  phone:  string;
  reason: string;
}

interface ImportResult {
  imported:    number;
  overwritten: number;
  duplicates:  number;
  errors:      ImportRowError[];
}

interface ImportApiResponse {
  success:     boolean;
  imported:    number;
  overwritten: number;
  skipped:     number;
  errors:      ImportRowError[];
}

export interface ImportContactsDrawerProps {
  open: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportContactsDrawer({ open, onClose }: ImportContactsDrawerProps) {
  const qc = useQueryClient();

  const [step,     setStep]     = useState<Step>('upload');
  const [detected, setDetected] = useState<Detected | null>(null);
  const [parseErr, setParseErr] = useState('');
  const [progress, setProgress] = useState(0);
  const [total,    setTotal]    = useState(0);
  const [result,   setResult]   = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef  = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  function reset() {
    setStep('upload'); setDetected(null); setParseErr('');
    setProgress(0); setTotal(0); setResult(null); abortRef.current = false;
  }

  function handleClose() {
    if (step === 'importing') return;
    reset();
    onClose();
  }

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseErr('Please upload a .csv file');
      return;
    }
    setParseErr('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);

      if (!headers.length) {
        setParseErr('Could not read this file. Make sure it is a valid CSV with column headers on the first row.');
        return;
      }
      if (!rows.length) {
        setParseErr('The file has no data rows. Add at least one contact and try again.');
        return;
      }

      const colPhone = detectCol(headers, PHONE_PATTERNS);
      const colName  = detectCol(headers, NAME_PATTERNS);
      const colEmail = detectCol(headers, EMAIL_PATTERNS);

      if (!colPhone) {
        setParseErr(
          `We couldn't find a phone number column. ` +
          `Your file has these columns: ${headers.join(', ')}. ` +
          `Rename one to "Phone" and try again, or use our template.`
        );
        return;
      }

      setDetected({ headers, rows, colPhone, colName, colEmail, fileName: file.name });
      setStep('preview');
    };
    reader.readAsText(file);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  // Uses the real bulk-import endpoint (one request handles the whole batch
  // server-side) instead of firing one POST /api/crm/leads per row — that
  // per-row approach blew straight through that endpoint's 30-req/min rate
  // limit on anything over ~30 rows, miscounting rate-limited rows as
  // generic "errors" with no reason ever surfaced to the user.
  const CHUNK = 2000; // matches the backend's own per-request cap

  async function startImport() {
    if (!detected) return;
    const { rows, colPhone, colName, colEmail } = detected;
    const validRows = rows.filter((r) => r[colPhone]?.trim());

    setTotal(validRows.length);
    setProgress(0);
    setStep('importing');
    abortRef.current = false;

    const leads = validRows.map((row) => {
      const phone = row[colPhone].trim();
      return {
        name:  colName  ? (row[colName]?.trim()  || phone) : phone,
        phone,
        email: colEmail ? (row[colEmail]?.trim() || null)  : null,
      };
    });

    const res: ImportResult = { imported: 0, overwritten: 0, duplicates: 0, errors: [] };

    for (let i = 0; i < leads.length; i += CHUNK) {
      if (abortRef.current) break;
      try {
        const chunk = leads.slice(i, i + CHUNK);
        const r = await apiFetch<ImportApiResponse>('/api/crm/import', {
          method: 'POST',
          body: JSON.stringify({ leads: chunk, options: { duplicateAction: 'skip' } }),
        });
        res.imported    += r.imported;
        res.overwritten += r.overwritten;
        res.duplicates  += r.skipped;
        res.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
      } catch (err: unknown) {
        // The whole chunk request itself failed (network/5xx) — every row in
        // it is unaccounted for; report each with the real error message
        // rather than silently dropping them.
        const message = err instanceof ApiClientError || err instanceof Error ? err.message : 'Request failed';
        leads.slice(i, i + CHUNK).forEach((l, j) => {
          res.errors.push({ row: i + j + 2, phone: l.phone, reason: message });
        });
      }
      setProgress(Math.min(i + CHUNK, leads.length));
    }

    setResult(res);
    setStep('done');
    if (res.imported > 0 || res.overwritten > 0) qc.invalidateQueries({ queryKey: ['contacts'] });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  const validCount = detected?.rows.filter((r) => r[detected.colPhone]?.trim()).length ?? 0;

  const previewRows = detected
    ? detected.rows
        .filter((r) => r[detected.colPhone]?.trim())
        .slice(0, 5)
    : [];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Import Contacts"
      description="Upload a CSV file to bulk-add contacts to your CRM"
      width={520}
      footer={
        step === 'preview' ? (
          <DrawerFooter>
            <Button variant="secondary" size="md" onClick={reset} type="button">
              Back
            </Button>
            <Button variant="primary" size="md" onClick={startImport}>
              Import {validCount} Contact{validCount !== 1 ? 's' : ''}
            </Button>
          </DrawerFooter>
        ) : step === 'done' ? (
          <DrawerFooter>
            <Button variant="secondary" size="md" onClick={reset} type="button">
              Import Another File
            </Button>
            <Button variant="primary" size="md" onClick={handleClose}>
              Done
            </Button>
          </DrawerFooter>
        ) : undefined
      }
    >
      {/* ── Upload ─────────────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-5">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl',
              'border-2 border-dashed p-10 transition-colors',
              dragOver
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
                : 'border-neutral-300 hover:border-primary-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900',
            )}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
              <Upload className="h-6 w-6 text-neutral-500" />
            </div>
            <div className="text-center">
              <p className="font-medium text-neutral-800 dark:text-neutral-200">
                Drop your CSV here, or{' '}
                <span className="text-primary-600 underline-offset-2 hover:underline">browse</span>
              </p>
              <p className="mt-1 text-sm text-neutral-500">.csv files only</p>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
          />

          {/* Error */}
          {parseErr && (
            <div className="flex gap-3 rounded-xl border border-error-100 bg-error-50 p-4">
              <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error-600" />
              <p className="text-sm text-error-700">{parseErr}</p>
            </div>
          )}

          {/* Template */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                  Need a template?
                </p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Download our ready-to-fill CSV. Only Phone is required — Name and Email are optional.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<DownloadIcon className="h-3.5 w-3.5" />}
                onClick={downloadTemplate}
                type="button"
                className="flex-shrink-0"
              >
                Template
              </Button>
            </div>
            <code className="mt-3 block rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800">
              Name, Phone, Email<br />
              Rahul Sharma, 9876543210, rahul@mail.com<br />
              Priya Patel, 9123456789,
            </code>
          </div>
        </div>
      )}

      {/* ── Preview ─────────────────────────────────────────────────────────── */}
      {step === 'preview' && detected && (
        <div className="flex flex-col gap-5">
          {/* File info */}
          <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
            <FileText className="h-4 w-4 flex-shrink-0 text-neutral-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {detected.fileName}
              </p>
              <p className="text-xs text-neutral-400">
                {validCount} contacts ready to import
                {detected.rows.length - validCount > 0 &&
                  ` · ${detected.rows.length - validCount} rows skipped (no phone)`}
              </p>
            </div>
          </div>

          {/* Detected column badges */}
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700">
              ✓ Phone → {detected.colPhone}
            </span>
            {detected.colName && (
              <span className="rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700">
                ✓ Name → {detected.colName}
              </span>
            )}
            {!detected.colName && (
              <span className="rounded-full bg-warning-50 px-3 py-1 text-xs font-medium text-warning-700">
                No name column — phone will be used as name
              </span>
            )}
            {detected.colEmail && (
              <span className="rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700">
                ✓ Email → {detected.colEmail}
              </span>
            )}
          </div>

          {/* Preview table */}
          <div>
            <p className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
              Preview — first {Math.min(5, validCount)} contacts
            </p>
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">Phone</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {previewRows.map((row, i) => (
                    <tr key={i} className="bg-white dark:bg-neutral-900">
                      <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">
                        {detected.colName ? (row[detected.colName] || <span className="text-neutral-400 italic text-xs">—</span>) : (
                          <span className="text-neutral-400 italic text-xs">will use phone</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-neutral-900 dark:text-neutral-100 tabular-nums">
                        {row[detected.colPhone]}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500 text-xs">
                        {detected.colEmail ? (row[detected.colEmail] || '—') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validCount > 5 && (
                <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-2 text-xs text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800">
                  + {validCount - 5} more contacts
                </div>
              )}
            </div>
          </div>

          <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            All contacts will be created with source <strong>CSV</strong> and assigned to you.
            Duplicate phone numbers will be skipped automatically.
          </p>
        </div>
      )}

      {/* ── Importing ───────────────────────────────────────────────────────── */}
      {step === 'importing' && (
        <div className="flex flex-col items-center gap-6 py-10">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 96 96">
              <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor"
                className="text-neutral-200 dark:text-neutral-700" strokeWidth="6" />
              <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor"
                className="text-primary-600" strokeWidth="6"
                strokeDasharray={`${2 * Math.PI * 42}`}
                strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.3s ease' }}
              />
            </svg>
            <span className="text-xl font-bold text-neutral-800 dark:text-neutral-200">{pct}%</span>
          </div>
          <div className="text-center">
            <p className="font-semibold text-neutral-800 dark:text-neutral-200">Importing…</p>
            <p className="mt-1 text-sm text-neutral-500">{progress} of {total} contacts processed</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { abortRef.current = true; }}>
            Cancel
          </Button>
        </div>
      )}

      {/* ── Done ────────────────────────────────────────────────────────────── */}
      {step === 'done' && result && (
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-3">
            {/* Imported */}
            <div className="flex items-center gap-4 rounded-xl border border-success-100 bg-success-50 px-4 py-4">
              <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-success-600" />
              <div>
                <p className="font-semibold text-success-700">
                  {result.imported} contact{result.imported !== 1 ? 's' : ''} imported
                </p>
                <p className="text-sm text-success-600">Successfully added to your CRM</p>
              </div>
            </div>

            {/* Overwritten */}
            {result.overwritten > 0 && (
              <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-4 dark:border-neutral-700 dark:bg-neutral-900">
                <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-neutral-500" />
                <div>
                  <p className="font-semibold text-neutral-700 dark:text-neutral-300">
                    {result.overwritten} existing contact{result.overwritten !== 1 ? 's' : ''} updated
                  </p>
                </div>
              </div>
            )}

            {/* Duplicates */}
            {result.duplicates > 0 && (
              <div className="flex items-center gap-4 rounded-xl border border-warning-100 bg-warning-50 px-4 py-4">
                <AlertTriangle className="h-6 w-6 flex-shrink-0 text-warning-600" />
                <div>
                  <p className="font-semibold text-warning-700">
                    {result.duplicates} duplicate{result.duplicates !== 1 ? 's' : ''} skipped
                  </p>
                  <p className="text-sm text-warning-600">These phone numbers already exist in your CRM</p>
                </div>
              </div>
            )}

            {/* Errors — real per-row reasons, not just a bare phone list */}
            {result.errors.length > 0 && (
              <div className="flex gap-4 rounded-xl border border-error-100 bg-error-50 px-4 py-4">
                <XCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-error-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-error-700">
                    {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} failed
                  </p>
                  <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <li key={i} className="text-xs text-error-600">
                        <span className="font-mono">{e.phone || `row ${e.row}`}</span>
                        {' — '}
                        {e.reason}
                      </li>
                    ))}
                  </ul>
                  {result.errors.length > 20 && (
                    <p className="mt-1 text-xs text-error-600">+ {result.errors.length - 20} more</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Total rows processed</span>
              <span className="font-medium text-neutral-800 dark:text-neutral-200">{total}</span>
            </div>
            <div className="mt-1.5 flex justify-between text-sm">
              <span className="text-neutral-500">Success rate</span>
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                {total > 0 ? Math.round(((result.imported + result.overwritten + result.duplicates) / total) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
