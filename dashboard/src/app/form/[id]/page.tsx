'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

const PRODUCTS = ['kyc', 'demat', 'mf', 'insurance', 'pms', 'algo'];
const PRODUCT_LABELS: Record<string, string> = {
  kyc: 'KYC', demat: 'Demat', mf: 'Mutual Funds', insurance: 'Insurance', pms: 'PMS', algo: 'Algo Trading',
};

interface FormMeta {
  id: string;
  name: string;
  fields: string[];
  thankYouMessage: string;
  redirectUrl?: string | null;
}

export default function PublicFormPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [products, setProducts] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  useEffect(() => {
    fetch(`${apiBase}/api/forms/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setMeta(d.form); else setNotFound(true); })
      .catch(() => setNotFound(true));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !phone.trim()) { setError('Name and phone are required.'); return; }
    if (phone.replace(/\D/g, '').length < 7) { setError('Enter a valid phone number.'); return; }

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/forms/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, productInterest: products, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.duplicate) { setError('This phone number is already registered. Our team will contact you.'); return; }
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
      if (data.redirectUrl) { setTimeout(() => { window.location.href = data.redirectUrl; }, 2500); }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  }

  if (!meta && !notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <span className="mb-4 text-5xl">🔍</span>
        <h1 className="text-xl font-bold text-slate-900">Form not found</h1>
        <p className="mt-2 text-sm text-slate-500">This form may have been removed or the link is incorrect.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-white p-6 text-center">
        <div className="mx-auto max-w-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <span className="text-3xl">✅</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Submitted!</h1>
          <p className="mt-2 text-sm text-slate-600">{meta?.thankYouMessage}</p>
          {meta?.redirectUrl && <p className="mt-4 text-xs text-slate-400">Redirecting you shortly…</p>}
        </div>
      </div>
    );
  }

  const fields = meta?.fields ?? ['name', 'phone'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-2xl">💼</div>
          <h1 className="text-xl font-bold text-slate-900">{meta?.name}</h1>
          <p className="mt-1 text-sm text-slate-500">Fill in your details and we'll get in touch.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-lg">
          {fields.includes('name') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Full Name <span className="text-red-500">*</span></label>
              <input value={name} onChange={(e) => setName(e.target.value)} required
                placeholder="Your full name"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100" />
            </div>
          )}
          {fields.includes('phone') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Phone Number <span className="text-red-500">*</span></label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel"
                placeholder="+91 98765 43210"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100" />
            </div>
          )}
          {fields.includes('email') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email Address</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100" />
            </div>
          )}
          {fields.includes('productInterest') && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">I'm interested in</label>
              <div className="flex flex-wrap gap-2">
                {PRODUCTS.map((p) => (
                  <button key={p} type="button"
                    onClick={() => setProducts((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${products.includes(p) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                    {PRODUCT_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {fields.includes('notes') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Message</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Any specific questions or requirements…"
                className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100" />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95">
            {loading ? <><span className="animate-spin">⟳</span> Submitting…</> : 'Submit →'}
          </button>

          <p className="text-center text-[11px] text-slate-400">
            Your information is kept private and will never be shared.
          </p>
        </form>
      </div>
    </div>
  );
}
