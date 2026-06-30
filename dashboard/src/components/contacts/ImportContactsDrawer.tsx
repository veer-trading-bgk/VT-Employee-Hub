'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { apiFetch } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let inQuotes = false;
  let cell = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cell.trim()); cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });
  return { headers, rows };
}

function detectCol(headers: string[], candidates: string[]): string {
  return (
    candidates
      .map((c) => headers.find((h) => h.toLowerCase().replace(/[^a-z]/g, '') === c.replace(/[^a-z]/g, '')))
      .find(Boolean) ?? ''
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'map' | 'importing' | 'done';

interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
  colName:  string;
  colPhone: string;
  colEmail: string;
}

interface ImportResult {
  imported:  number;
  duplicates: number;
  errors:    number;
  errorRows: string[];
}

export interface ImportContactsDrawerProps {
  open: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportContactsDrawer({ open, onClose }: ImportContactsDrawerProps) {
  const qc = useQueryClient();

  const [step,      setStep]      = useState<Step>('upload');
  const [parsed,    setParsed]    = useState<ParsedData | null>(null);
  const [colName,   setColName]   = useState('');
  const [colPhone,  setColPhone]  = useState('');
  const [colEmail,  setColEmail]  = useState('');
  const [progress,  setProgress]  = useState(0);
  const [total,     setTotal]     = useState(0);
  const [result,    setResult]    = useState<ImportResult | null>(null);
  const [dragOver,  setDragOver]  = useState(false);
  const [fileName,  setFileName]  = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  function resetAll() {
    setStep('upload'); setParsed(null); setColName(''); setColPhone('');
    setColEmail(''); setProgress(0); setTotal(0); setResult(null);
    setFileName(''); abortRef.current = false;
  }

  function handleClose() {
    if (step === 'importing') return; // block close mid-import
    resetAll();
    onClose();
  }

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      alert('Please upload a .csv file');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      if (!headers.length || !rows.length) {
        alert('CSV is empty or could not be parsed');
        return;
      }
      const detectedName  = detectCol(headers, ['name', 'fullname', 'contactname', 'customername', 'leadname']);
      const detectedPhone = detectCol(headers, ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'contact']);
      const detectedEmail = detectCol(headers, ['email', 'emailaddress', 'mail']);
      setParsed({ headers, rows, colName: detectedName, colPhone: detectedPhone, colEmail: detectedEmail });
      setColName(detectedName);
      setColPhone(detectedPhone);
      setColEmail(detectedEmail);
      setStep('map');
    };
    reader.readAsText(file);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  async function startImport() {
    if (!parsed || !colPhone) return;
    const rows = parsed.rows.filter((r) => r[colPhone]?.trim());
    setTotal(rows.length);
    setProgress(0);
    setStep('importing');
    abortRef.current = false;

    const res: ImportResult = { imported: 0, duplicates: 0, errors: 0, errorRows: [] };

    // batch: 5 concurrent requests, pause 200ms between batches to avoid rate-limit
    const BATCH = 5;
    for (let i = 0; i < rows.length; i += BATCH) {
      if (abortRef.current) break;
      const batch = rows.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (row) => {
          const name  = colName  ? (row[colName]  ?? '').trim() : '';
          const phone = (row[colPhone] ?? '').trim();
          const email = colEmail ? (row[colEmail] ?? '').trim() : '';
          try {
            await apiFetch('/api/crm/leads', {
              method: 'POST',
              body: JSON.stringify({
                name:   name || phone, // use phone as fallback name
                phone,
                email:  email || null,
                source: 'csv',
              }),
            });
            res.imported++;
          } catch (err: any) {
            if (err?.status === 409 || String(err?.message).includes('409')) {
              res.duplicates++;
            } else {
              res.errors++;
              if (res.errorRows.length < 5) res.errorRows.push(phone);
            }
          }
        }),
      );
      setProgress(Math.min(i + BATCH, rows.length));
      if (i + BATCH < rows.length) await new Promise((r) => setTimeout(r, 150));
    }

    setResult(res);
    setStep('done');
    if (res.imported > 0) qc.invalidateQueries({ queryKey: ['contacts'] });
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const SEL_CLS =
    'h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm ' +
    'focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 ' +
    'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200';

  function ColSelect({ label, value, onChange }: {
    label: string; value: string; onChange: (v: string) => void;
  }) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{label}</label>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={SEL_CLS}>
          <option value="">— Skip —</option>
          {parsed?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>
    );
  }

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Import Contacts"
      description="Upload a CSV file to bulk-import contacts"
      width={520}
      footer={
        step === 'upload' ? undefined :
        step === 'map' ? (
          <DrawerFooter>
            <Button variant="secondary" size="md" onClick={resetAll} type="button">Back</Button>
            <Button
              variant="primary"
              size="md"
              onClick={startImport}
              disabled={!colPhone}
            >
              Import {parsed?.rows.filter((r) => r[colPhone]?.trim()).length ?? 0} Contacts
            </Button>
          </DrawerFooter>
        ) :
        step === 'done' ? (
          <DrawerFooter>
            <Button variant="secondary" size="md" onClick={resetAll} type="button">Import Another</Button>
            <Button variant="primary" size="md" onClick={handleClose}>Done</Button>
          </DrawerFooter>
        ) : undefined
      }
    >
      {/* ── Step: Upload ─────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors',
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
                Drop your CSV here or <span className="text-primary-600">browse</span>
              </p>
              <p className="mt-1 text-sm text-neutral-500">Supports .csv files — UTF-8 encoding recommended</p>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
          />

          {/* Template hint */}
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">Expected CSV format</p>
            <code className="block rounded bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Name,Phone,Email<br />
              Rahul Sharma,9876543210,rahul@email.com<br />
              Priya Patel,9123456789,
            </code>
            <p className="mt-2 text-xs text-neutral-500">
              Column names are auto-detected. Only Phone is required — Name and Email are optional.
            </p>
          </div>
        </div>
      )}

      {/* ── Step: Map columns ─────────────────────────────────────────────── */}
      {step === 'map' && parsed && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
            <FileText className="h-4 w-4 flex-shrink-0 text-neutral-400" />
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{fileName}</p>
            <span className="ml-auto text-xs text-neutral-400">{parsed.rows.length} rows detected</span>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              Map CSV columns to contact fields
            </h3>
            <div className="flex flex-col gap-3">
              <ColSelect label="Phone *" value={colPhone} onChange={setColPhone} />
              <ColSelect label="Name"    value={colName}  onChange={setColName} />
              <ColSelect label="Email"   value={colEmail} onChange={setColEmail} />
            </div>
            {!colPhone && (
              <p className="mt-2 text-xs text-error-600">Phone column is required to import</p>
            )}
          </div>

          {/* Preview */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              Preview (first 5 rows)
            </h3>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
              <table className="min-w-full text-xs">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    {['Name', 'Phone', 'Email'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-neutral-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300">
                        {colName ? row[colName] : <span className="text-neutral-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-2 font-medium text-neutral-800 dark:text-neutral-200">
                        {colPhone ? row[colPhone] : <span className="text-error-500">missing</span>}
                      </td>
                      <td className="px-3 py-2 text-neutral-500">
                        {colEmail ? row[colEmail] || '—' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Importing ───────────────────────────────────────────────── */}
      {step === 'importing' && (
        <div className="flex flex-col items-center gap-6 py-8">
          <div className="relative flex h-20 w-20 items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor"
                className="text-neutral-200 dark:text-neutral-700" strokeWidth="6" />
              <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor"
                className="text-primary-600" strokeWidth="6"
                strokeDasharray={`${2 * Math.PI * 36}`}
                strokeDashoffset={`${2 * Math.PI * 36 * (1 - pct / 100)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.3s ease' }}
              />
            </svg>
            <span className="text-lg font-bold text-neutral-800 dark:text-neutral-200">{pct}%</span>
          </div>
          <div className="text-center">
            <p className="font-medium text-neutral-800 dark:text-neutral-200">Importing contacts…</p>
            <p className="mt-1 text-sm text-neutral-500">{progress} of {total} processed</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { abortRef.current = true; }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* ── Step: Done ────────────────────────────────────────────────────── */}
      {step === 'done' && result && (
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-success-100 bg-success-50 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-success-600" />
              <div>
                <p className="font-semibold text-success-700">
                  {result.imported} contacts imported
                </p>
                <p className="text-sm text-success-600">
                  Successfully added to your CRM
                </p>
              </div>
            </div>

            {result.duplicates > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-warning-100 bg-warning-50 px-4 py-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 text-warning-600" />
                <div>
                  <p className="font-semibold text-warning-700">
                    {result.duplicates} duplicates skipped
                  </p>
                  <p className="text-sm text-warning-600">
                    These phone numbers already exist in your CRM
                  </p>
                </div>
              </div>
            )}

            {result.errors > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-error-100 bg-error-50 px-4 py-3">
                <XCircle className="h-5 w-5 flex-shrink-0 text-error-600" />
                <div>
                  <p className="font-semibold text-error-700">
                    {result.errors} rows failed
                  </p>
                  {result.errorRows.length > 0 && (
                    <p className="mt-1 font-mono text-xs text-error-600">
                      {result.errorRows.join(', ')}
                      {result.errors > result.errorRows.length ? ` + ${result.errors - result.errorRows.length} more` : ''}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">Total processed</span>
              <span className="font-medium text-neutral-800 dark:text-neutral-200">{total}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-neutral-500">Success rate</span>
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                {total > 0 ? Math.round(((result.imported + result.duplicates) / total) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
