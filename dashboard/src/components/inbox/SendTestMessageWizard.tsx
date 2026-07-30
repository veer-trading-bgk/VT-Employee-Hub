'use client';

// Guided "send your first message" flow (P0.3). Reuses the exact same
// backend contract MetaHealthPanel's inline test-message panel already
// uses (GET /api/whatsapp/templates, POST /api/whatsapp/send-test) — no
// new backend work. The value this adds over that existing panel is
// purely UX: reachable directly from the dashboard checklist and the
// Inbox empty state (not buried in Settings), and it gives real guidance
// instead of a dead end when no approved template exists yet, which is
// the single biggest reason a brand-new company's first send attempt
// fails (WhatsApp requires an approved template to message someone who
// hasn't messaged the business first — this is Meta's rule, not ours).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileWarning, Send } from 'lucide-react';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Select } from '@/components/v3/ui/Select';
import { apiFetch, apiErrorMessage } from '@/lib/api';

interface WaTemplate {
  id: string;
  name: string;
  templateName: string;
  language: string;
  status: string;
}

interface TemplatesResponse { success: boolean; templates: WaTemplate[] }
interface SendTestResponse { success: boolean; messageId: string; timestamp: string }

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

interface SendTestMessageWizardProps {
  open: boolean;
  onClose: () => void;
}

export function SendTestMessageWizard({ open, onClose }: SendTestMessageWizardProps) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { data, isLoading } = useQuery<TemplatesResponse>({
    queryKey: ['whatsapp-templates'],
    queryFn: () => apiFetch<TemplatesResponse>('/api/whatsapp/templates'),
    enabled: open,
  });

  const approved = (data?.templates ?? []).filter((t) => t.status === 'APPROVED');
  const activeTemplateId = templateId || approved[0]?.id || '';

  async function handleSend() {
    if (!E164_REGEX.test(phone.trim())) {
      setError('Enter a phone number with country code, e.g. +919876543210');
      return;
    }
    if (!activeTemplateId) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch<SendTestResponse>('/api/whatsapp/send-test', {
        method: 'POST',
        retries: 0,
        body: JSON.stringify({ toPhone: phone.trim(), templateId: activeTemplateId }),
      });
      setSent(true);
    } catch (e: unknown) {
      setError(apiErrorMessage(e, 'Could not send the test message.'));
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    onClose();
    // Reset for next open — the parent doesn't remount this with a key
    // the way EmbeddedSignupWizard's parent does, so do it here instead.
    setTimeout(() => { setPhone(''); setTemplateId(''); setSent(false); setError(null); }, 300);
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Send a Test Message"
      description="See your WhatsApp connection working end to end"
      footer={
        sent ? (
          <DrawerFooter>
            <Button variant="primary" size="md" onClick={handleClose}>Done</Button>
          </DrawerFooter>
        ) : approved.length > 0 ? (
          <DrawerFooter>
            <Button variant="secondary" size="md" onClick={handleClose} disabled={sending}>Cancel</Button>
            <Button variant="primary" size="md" loading={sending} onClick={handleSend} iconLeft={<Send className="h-3.5 w-3.5" />}>
              Send
            </Button>
          </DrawerFooter>
        ) : (
          <DrawerFooter>
            <Button variant="secondary" size="md" onClick={handleClose}>Close</Button>
          </DrawerFooter>
        )
      }
    >
      {isLoading ? (
        <div className="py-10 text-center text-sm text-neutral-500">Checking your message templates…</div>
      ) : sent ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-success-600" aria-hidden />
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Test message sent!</p>
          <p className="max-w-xs text-xs text-neutral-500">
            Check {phone} for the message. Once they reply, the conversation will show up in your Inbox.
          </p>
        </div>
      ) : approved.length === 0 ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-800 dark:bg-warning-900/20">
            <FileWarning className="h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" aria-hidden />
            <div className="space-y-1">
              <p className="text-xs font-medium text-warning-800 dark:text-warning-300">
                You need an approved message template first
              </p>
              <p className="text-xs text-warning-700 dark:text-warning-400">
                WhatsApp requires a pre-approved template to message someone who hasn&apos;t messaged your
                business yet — this is WhatsApp&apos;s rule, not ours. It only applies to the very first
                message; once a customer replies, you can chat freely for 24 hours.
              </p>
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            In the meantime — you don&apos;t need to wait. If a customer messages your WhatsApp number first,
            it will show up in your Inbox automatically, no template needed.
          </p>
          <Button variant="primary" size="md" className="w-full" onClick={() => { handleClose(); router.push('/settings?tab=templates'); }}>
            Create a Message Template
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Send to
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919876543210"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
            <p className="mt-1 text-[11px] text-neutral-500">Include the country code — try your own number.</p>
          </div>
          {approved.length > 1 && (
            <Select
              label="Template"
              value={activeTemplateId}
              onChange={(e) => setTemplateId(e.target.value)}
              options={approved.map((t) => ({ value: t.id, label: t.templateName ?? t.name }))}
            />
          )}
          {error && <p className="text-xs text-error-600 dark:text-error-400">{error}</p>}
        </div>
      )}
    </Drawer>
  );
}
