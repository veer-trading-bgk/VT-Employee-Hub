'use client';

import { useState } from 'react';
import {
  PhoneCall,
  ExternalLink,
  Copy,
  ChevronRight,
  ImageIcon,
  FileText,
  Video,
  MapPin,
  CornerDownRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TemplateFormValues } from '@/lib/templates/types';

interface Props {
  form: TemplateFormValues;
  /** Optional variable substitution values */
  variableValues?: string[];
  darkMode?: boolean;
  className?: string;
}

// Substitute {{n}} placeholders with provided values or a styled placeholder
function substituteVars(text: string, values: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const val = values[parseInt(n) - 1];
    return val ?? `{{${n}}}`;
  });
}

// Render text with WhatsApp-style formatting
function RichText({ text, className }: { text: string; className?: string }) {
  // Split by formatting markers: *bold*, _italic_, ~strike~, ```mono```
  const parts = text.split(/(\*[^*]+\*|_[^_]+_|~[^~]+~|```[^`]+```)/);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <strong key={i}>{part.slice(1, -1)}</strong>;
        }
        if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
          return <s key={i}>{part.slice(1, -1)}</s>;
        }
        if (part.startsWith('```') && part.endsWith('```') && part.length > 6) {
          return <code key={i} className="font-mono text-[11px]">{part.slice(3, -3)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export function WhatsAppPreview({ form, variableValues = [], darkMode = false, className }: Props) {
  const [isDark, setIsDark] = useState(darkMode);

  const isAuth = form.category === 'AUTHENTICATION';
  const bodyText = isAuth
    ? `Your verification code is {{1}}${form.addSecurityRecommendation ? '\n\nFor your security, do not share this code.' : ''}${form.codeExpirationMinutes ? `\n\nThis code expires in ${form.codeExpirationMinutes} minutes.` : ''}`
    : form.bodyText;

  const substitutedBody = substituteVars(bodyText, variableValues);
  const substitutedHeader = form.headerType === 'TEXT'
    ? substituteVars(form.headerText, variableValues)
    : '';

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Device toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-500">Live Preview</p>
        <button
          type="button"
          onClick={() => setIsDark((d) => !d)}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          {isDark ? '☀ Light' : '🌙 Dark'}
        </button>
      </div>

      {/* Phone frame */}
      <div
        className={cn(
          'mx-auto w-full max-w-[320px] overflow-hidden rounded-[28px] border-4 shadow-xl',
          isDark ? 'border-neutral-700 bg-[#0B141A]' : 'border-neutral-200 bg-[#E5DDD5]',
        )}
      >
        {/* Status bar */}
        <div className={cn('flex items-center justify-between px-4 py-1.5',
          isDark ? 'bg-[#1F2C34]' : 'bg-[#008069]'
        )}>
          <span className="text-[10px] font-semibold text-white">9:41</span>
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-white/70" />
            <div className="h-1.5 w-1.5 rounded-full bg-white/70" />
            <div className="h-1.5 w-1.5 rounded-full bg-white/70" />
          </div>
        </div>

        {/* WhatsApp header */}
        <div className={cn('flex items-center gap-2.5 px-3 py-2',
          isDark ? 'bg-[#1F2C34]' : 'bg-[#008069]'
        )}>
          <div className="h-8 w-8 rounded-full bg-neutral-300 flex items-center justify-center text-xs font-bold text-neutral-600">
            AP
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-white">{form.name || 'Template Preview'}</p>
            <p className="text-[9px] text-white/70">Business</p>
          </div>
        </div>

        {/* Chat area */}
        <div
          className={cn('min-h-[260px] px-3 py-3',
            isDark
              ? "bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzBCMTQxQSIvPjwvc3ZnPg==')] bg-[#0B141A]"
              : 'bg-[#E5DDD5]',
          )}
        >
          {/* Message bubble */}
          <div className="flex justify-center">
            <div
              className={cn(
                'w-full max-w-[260px] overflow-hidden rounded-lg shadow-sm',
                isDark ? 'bg-[#1F2C34]' : 'bg-white',
              )}
            >
              {/* Header */}
              {form.headerType !== 'NONE' && (
                <div className={cn('w-full', ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType) ? '' : 'px-3 pt-2.5')}>
                  {form.headerType === 'IMAGE' && (
                    <div className={cn('flex h-28 w-full items-center justify-center', isDark ? 'bg-neutral-700' : 'bg-neutral-100')}>
                      {form.headerMediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.headerMediaUrl} alt="Header" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-neutral-400" aria-label="Image placeholder" />
                      )}
                    </div>
                  )}
                  {form.headerType === 'VIDEO' && (
                    <div className={cn('flex h-28 w-full items-center justify-center', isDark ? 'bg-neutral-700' : 'bg-neutral-100')}>
                      <Video className="h-8 w-8 text-neutral-400" aria-label="Video placeholder" />
                    </div>
                  )}
                  {form.headerType === 'DOCUMENT' && (
                    <div className={cn('flex items-center gap-2 rounded-md p-2.5', isDark ? 'bg-neutral-700' : 'bg-neutral-100')}>
                      <FileText className="h-6 w-6 shrink-0 text-red-500" aria-hidden />
                      <span className={cn('text-xs font-medium', isDark ? 'text-white' : 'text-neutral-700')}>
                        Document.pdf
                      </span>
                    </div>
                  )}
                  {form.headerType === 'LOCATION' && (
                    <div className={cn('flex h-20 w-full items-center justify-center', isDark ? 'bg-green-900/20' : 'bg-green-50')}>
                      <MapPin className="h-8 w-8 text-green-600" aria-label="Location placeholder" />
                    </div>
                  )}
                  {form.headerType === 'TEXT' && substitutedHeader && (
                    <p className={cn('text-sm font-semibold leading-snug px-3 pt-2.5', isDark ? 'text-white' : 'text-neutral-900')}>
                      {substitutedHeader}
                    </p>
                  )}
                </div>
              )}

              {/* Body */}
              {substitutedBody ? (
                <div className={cn('px-3 py-2', form.headerType === 'NONE' ? 'pt-2.5' : '')}>
                  <p className={cn('whitespace-pre-wrap text-[13px] leading-[1.45]', isDark ? 'text-neutral-100' : 'text-neutral-800')}>
                    <RichText text={substitutedBody} />
                  </p>
                </div>
              ) : (
                <div className="px-3 py-2">
                  <p className="text-[12px] italic text-neutral-400">Body text will appear here…</p>
                </div>
              )}

              {/* Footer */}
              {form.footerEnabled && form.footerText && (
                <div className="px-3 pb-1.5">
                  <p className={cn('text-[10px]', isDark ? 'text-neutral-500' : 'text-neutral-400')}>
                    {form.footerText}
                  </p>
                </div>
              )}

              {/* Authentication footer */}
              {isAuth && form.codeExpirationMinutes > 0 && (
                <div className="px-3 pb-1.5">
                  <p className={cn('text-[10px]', isDark ? 'text-neutral-500' : 'text-neutral-400')}>
                    This code expires in {form.codeExpirationMinutes} minutes.
                  </p>
                </div>
              )}

              {/* Timestamp */}
              <div className="flex justify-end px-3 pb-1.5">
                <span className={cn('text-[9px]', isDark ? 'text-neutral-500' : 'text-neutral-400')}>
                  {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ✓✓
                </span>
              </div>

              {/* Buttons */}
              {form.buttonsEnabled && form.buttons.length > 0 && (
                <div className={cn('border-t', isDark ? 'border-neutral-700' : 'border-neutral-200')}>
                  {form.buttons.map((btn, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium',
                        i > 0 && (isDark ? 'border-t border-neutral-700' : 'border-t border-neutral-200'),
                        isDark ? 'text-[#53BDEB]' : 'text-[#00A884]',
                      )}
                    >
                      {btn.type === 'QUICK_REPLY' && (
                        <>
                          <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
                          {btn.text || 'Quick Reply'}
                        </>
                      )}
                      {btn.type === 'URL' && (
                        <>
                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                          {btn.text || 'Visit Website'}
                        </>
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <>
                          <PhoneCall className="h-3 w-3 shrink-0" aria-hidden />
                          {btn.text || 'Call'}
                        </>
                      )}
                      {btn.type === 'OTP' && btn.otpType === 'COPY_CODE' && (
                        <>
                          <Copy className="h-3 w-3 shrink-0" aria-hidden />
                          {btn.text || 'Copy Code'}
                        </>
                      )}
                      {btn.type === 'OTP' && btn.otpType === 'ONE_TAP' && (
                        <>
                          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                          {btn.text || 'Autofill Code'}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className={cn('rounded-lg border px-3 py-2 text-[11px]',
        'border-neutral-200 bg-neutral-50 text-neutral-500',
        'dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400',
      )}>
        <p className="font-medium mb-1">Variables</p>
        {(form.bodyVariables ?? []).map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <code className="rounded bg-neutral-200 px-1 py-0.5 text-[10px] dark:bg-neutral-700">
              {`{{${i + 1}}}`}
            </code>
            <span>{v.description || v.example || `Variable ${i + 1}`}</span>
          </div>
        ))}
        {(form.bodyVariables ?? []).length === 0 && (
          <p className="italic">No variables</p>
        )}
      </div>
    </div>
  );
}
