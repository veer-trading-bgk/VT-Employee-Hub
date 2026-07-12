import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Host-based routing so one Vercel project serves both the app
// (app.apforce.in — the existing dashboard/login) and the public marketing
// site (apforce.in, www.apforce.in — required for Meta App Review's "link
// to your website"). Only the marketing hosts' root path is rewritten;
// every other host (app.apforce.in, any preview/vercel.app alias) and every
// other path passes through completely untouched — zero behavior change
// for the existing app.
const MARKETING_HOSTS = new Set(['apforce.in', 'www.apforce.in']);

export function proxy(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0] ?? '';

  if (MARKETING_HOSTS.has(host) && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/marketing';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
