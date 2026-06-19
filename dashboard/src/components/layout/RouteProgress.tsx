'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function RouteProgress() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [width, setWidth] = useState(0);
  const prev = useRef(pathname);
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pathname === prev.current) return;
    prev.current = pathname;

    if (t1.current) clearTimeout(t1.current);
    if (t2.current) clearTimeout(t2.current);

    setWidth(0);
    setShow(true);

    t1.current = setTimeout(() => setWidth(92), 10);
    t2.current = setTimeout(() => {
      setWidth(100);
      setTimeout(() => setShow(false), 250);
    }, 380);

    return () => {
      if (t1.current) clearTimeout(t1.current);
      if (t2.current) clearTimeout(t2.current);
    };
  }, [pathname]);

  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[2px]">
      <div
        className="h-full rounded-r-full bg-indigo-600 dark:bg-indigo-400"
        style={{
          width: `${width}%`,
          transition: width === 100 ? 'width 200ms ease-out' : 'width 380ms cubic-bezier(0.4,0,0.2,1)',
        }}
      />
    </div>
  );
}
