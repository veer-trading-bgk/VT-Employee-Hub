'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Confirm before closing if form is dirty */
  confirmClose?: boolean;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 420,
  confirmClose = false,
}: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  // Trap focus inside drawer
  useEffect(() => {
    if (!open) return;
    const el = drawerRef.current;
    if (!el) return;

    const focusable = el.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    );
    firstFocusableRef.current = focusable[0] ?? null;
    lastFocusRef.current = focusable[focusable.length - 1] ?? null;
    firstFocusableRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusableRef.current) {
            e.preventDefault();
            lastFocusRef.current?.focus();
          }
        } else {
          if (document.activeElement === lastFocusRef.current) {
            e.preventDefault();
            firstFocusableRef.current?.focus();
          }
        }
      }
      if (e.key === 'Escape') handleClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    if (confirmClose) {
      if (!window.confirm('Discard unsaved changes?')) return;
    }
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={handleClose}
        className={cn(
          'fixed inset-0 bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        style={{ zIndex: 300 }}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'fixed inset-y-0 right-0 flex flex-col bg-white shadow-drawer',
          'transition-transform duration-300 ease-out',
          'dark:bg-neutral-900',
          /* Mobile: bottom sheet */
          'max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:h-[80vh] max-md:rounded-t-2xl',
          open
            ? 'translate-x-0 max-md:translate-y-0'
            : 'translate-x-full max-md:translate-x-0 max-md:translate-y-full',
        )}
        style={{ zIndex: 300, width: `min(${width}px, 100vw)` }}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-3 md:hidden" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-neutral-300" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-sm text-neutral-500">{description}</p>
            )}
          </div>
          <button
            onClick={handleClose}
            aria-label="Close drawer"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 sm:h-8 sm:w-8 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/* Footer — sticky */}
        {footer && (
          <div className="border-t border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

// Drawer footer helpers
export function DrawerFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-2', className)}>
      {children}
    </div>
  );
}

export function DrawerSubmit({
  onCancel,
  submitLabel = 'Save',
  loading = false,
  disabled = false,
}: {
  onCancel: () => void;
  submitLabel?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <DrawerFooter>
      <Button variant="secondary" size="md" onClick={onCancel} type="button">
        Cancel
      </Button>
      <Button variant="primary" size="md" loading={loading} disabled={disabled} type="submit">
        {submitLabel}
      </Button>
    </DrawerFooter>
  );
}
