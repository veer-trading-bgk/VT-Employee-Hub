'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Input } from '@/components/v3/ui/Input';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { STAGE_LABELS } from '@/types/v3';
import type { Stage } from '@/types/v3';

interface EmployeeRecord { id: string; name: string; role: string; }

const SEL_CLS =
  'h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700 ' +
  'focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 ' +
  'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200';

const FIELD_CLS = 'flex flex-col gap-1.5';
const LABEL_CLS = 'text-sm font-medium text-neutral-700 dark:text-neutral-200';

const SOURCE_OPTIONS = [
  { value: 'manual',    label: 'Manual' },
  { value: 'referral',  label: 'Referral' },
  { value: 'website',   label: 'Website' },
  { value: 'whatsapp',  label: 'WhatsApp' },
  { value: 'walk_in',   label: 'Walk-in' },
  { value: 'social',    label: 'Social Media' },
  { value: 'webinar',   label: 'Webinar' },
  { value: 'facebook',  label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
];

export interface NewContactDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function NewContactDrawer({ open, onClose }: NewContactDrawerProps) {
  const qc     = useQueryClient();
  const router = useRouter();

  const [name,       setName]       = useState('');
  const [phone,      setPhone]      = useState('');
  const [email,      setEmail]      = useState('');
  const [stage,      setStage]      = useState('');
  const [source,     setSource]     = useState('manual');
  const [assignedTo, setAssignedTo] = useState('');
  const [notes,      setNotes]      = useState('');
  const [errors,     setErrors]     = useState<Record<string, string>>({});
  const [dupContact, setDupContact] = useState<{ name: string; id: string } | null>(null);

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () =>
      apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(
        () => ({ success: true, data: [] as EmployeeRecord[] }),
      ),
    staleTime: 10 * 60_000,
    enabled: open,
  });
  const employees = (empData?.data ?? []).filter((e) =>
    ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role),
  );

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ leadId?: string; lead?: { leadId: string } }>('/api/crm/leads', {
        method: 'POST',
        body: JSON.stringify({
          name:           name.trim(),
          phone:          phone.trim(),
          email:          email.trim() || null,
          stage:          stage || undefined,
          source:         source,
          notes:          notes.trim() || undefined,
          assignedTo:     assignedTo || undefined,
          assignedToName: assignedTo
            ? (employees.find((e) => e.id === assignedTo)?.name ?? null)
            : undefined,
        }),
      }),
    onSuccess: (data) => {
      toast.success('Contact created');
      qc.invalidateQueries({ queryKey: ['contacts'] });
      const id = data?.leadId ?? data?.lead?.leadId;
      resetForm();
      onClose();
      if (id) router.push(`/contacts/${id}`);
    },
    onError: (err: any) => {
      if (err?.status === 409) {
        const existingName = (err?.body?.existingName as string | undefined) ?? 'an existing contact';
        const existingId   = (err?.body?.existingLeadId as string | undefined) ?? '';
        setErrors((p) => ({ ...p, phone: ' ' })); // triggers red border on Input
        setDupContact({ name: existingName, id: existingId });
      } else {
        toast.error('Failed to create contact — check your permissions');
      }
    },
  });

  function resetForm() {
    setName(''); setPhone(''); setEmail(''); setStage('');
    setSource('manual'); setAssignedTo(''); setNotes(''); setErrors({});
    setDupContact(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!name.trim())  e.name  = 'Name is required';
    if (!phone.trim()) e.phone = 'Phone number is required';
    else if (!/^\+?[\d\s\-().]{7,15}$/.test(phone.trim())) e.phone = 'Enter a valid phone number';
    return e;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (Object.keys(v).length > 0) { setErrors(v); return; }
    mutation.mutate();
  }

  const isDirty = !!(name || phone || email || notes);

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="New Contact"
      description="Add a contact to your CRM pipeline"
      confirmClose={isDirty}
      width={480}
      footer={
        <DrawerFooter>
          <Button variant="secondary" size="md" onClick={handleClose} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={mutation.isPending}
            form="new-contact-form"
            type="submit"
          >
            Create Contact
          </Button>
        </DrawerFooter>
      }
    >
      <form id="new-contact-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Input
          label="Full Name"
          required
          placeholder="e.g. Rahul Sharma"
          value={name}
          onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })); }}
          error={errors.name}
          autoFocus
        />

        <Input
          label="Phone"
          required
          phonePrefix
          placeholder="9876543210"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setErrors((p) => ({ ...p, phone: '' })); setDupContact(null); }}
          error={dupContact ? ' ' : errors.phone}
          type="tel"
          inputMode="numeric"
        />

        {dupContact && (
          <div className="flex items-center gap-3 rounded-lg border border-error-100 bg-error-50 px-3 py-2.5 -mt-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-error-700">
                This number belongs to{' '}
                <span className="font-semibold">"{dupContact.name}"</span>
                {' '}in your CRM.
              </p>
            </div>
            {dupContact.id && (
              <Link
                href={`/contacts/${dupContact.id}`}
                onClick={onClose}
                className="flex flex-shrink-0 items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                View contact <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}

        <Input
          label="Email"
          type="email"
          placeholder="rahul@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Stage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={SEL_CLS}>
              <option value="">New Lead (default)</option>
              {(Object.entries(STAGE_LABELS) as [Stage, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={SEL_CLS}>
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>Assign To</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={SEL_CLS}>
            <option value="">Auto-assign</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <p className="text-xs text-neutral-400">Leave blank to auto-assign based on round-robin rules</p>
        </div>

        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Initial context, source details, etc."
            rows={3}
            className={
              'w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm ' +
              'text-neutral-700 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none ' +
              'focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200'
            }
          />
        </div>
      </form>
    </Drawer>
  );
}
