'use client';

/**
 * Public journey pages are designed light-only (white cards, slate text) and
 * sit outside the (v3) shell. Root layout + ThemeProvider default <html> to
 * `.dark` when vt-theme is unset/non-light, which flips v3 Input/Select to
 * dark:bg-neutral-900 and tanks contrast on phones. form/[id] escapes this
 * by using raw inputs without dark: variants; we keep v3 Input/Select and
 * instead pin this route to light for the visit.
 *
 * ThemeProvider may re-add `.dark` after mount — MutationObserver re-asserts.
 */
import { useEffect } from 'react';

export function JourneyPublicLightShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;

    const forceLight = () => {
      if (root.classList.contains('dark')) root.classList.remove('dark');
      if (root.style.colorScheme !== 'light') root.style.colorScheme = 'light';
    };

    forceLight();
    const mo = new MutationObserver(forceLight);
    mo.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });

    return () => {
      mo.disconnect();
      root.style.colorScheme = '';
      let stored: string | null = null;
      try {
        stored = localStorage.getItem('vt-theme');
      } catch {
        stored = null;
      }
      // Match root layout bootstrap + ThemeProvider default (unset → dark).
      root.classList.toggle('dark', stored !== 'light');
    };
  }, []);

  return (
    <div data-testid="journey-light-shell" className="journey-public-light" style={{ colorScheme: 'light' }}>
      {children}
    </div>
  );
}
