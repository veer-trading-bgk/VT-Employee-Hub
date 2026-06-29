'use client';

import { useState } from 'react';

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.532 5.849L0 24l6.335-1.508A11.933 11.933 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.369l-.36-.214-3.727.977.995-3.635-.235-.374A9.818 9.818 0 1112 21.818z" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

interface ContactIdentityBlockProps {
  name: string;
  phone: string;
  email?: string | null;
}

export function ContactIdentityBlock({ name, phone, email }: ContactIdentityBlockProps) {
  const [copied, setCopied] = useState(false);

  function copyPhone() {
    navigator.clipboard.writeText(phone).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const digits = phone.replace(/\D/g, '');
  const waUrl = `https://wa.me/${digits}`;

  return (
    <div className="min-w-0">
      <h1 className="truncate text-lg font-bold text-slate-900 dark:text-white sm:text-xl">
        {name || phone || 'Unknown Contact'}
      </h1>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Phone */}
        {phone && (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm text-slate-600 dark:text-slate-300">
              +91&nbsp;{phone}
            </span>
            <button
              onClick={copyPhone}
              title={copied ? 'Copied!' : 'Copy phone number'}
              aria-label={copied ? 'Phone number copied' : 'Copy phone number'}
              className="rounded p-0.5 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
            >
              <CopyIcon className="h-3.5 w-3.5" />
            </button>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in WhatsApp Web"
              aria-label="Open WhatsApp"
              className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-600 transition hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
            >
              <WhatsAppIcon className="h-3 w-3" />
              WhatsApp
            </a>
          </div>
        )}

        {/* Email */}
        {email && (
          <div className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <MailIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="max-w-[200px] truncate">{email}</span>
          </div>
        )}
      </div>
    </div>
  );
}
