import type { Metadata } from 'next';
import Link from 'next/link';
import { Fraunces, Public_Sans, IBM_Plex_Mono } from 'next/font/google';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const body = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const PRODUCT_DESCRIPTION =
  'APForce is a WhatsApp CRM software platform. Businesses connect their own WhatsApp Business Account to manage contacts, conversations, and automated messaging through their own number.';

export const metadata: Metadata = {
  title: 'APForce — WhatsApp CRM for AP & Sub-Brokers',
  description: PRODUCT_DESCRIPTION,
  metadataBase: new URL('https://apforce.in'),
  openGraph: {
    title: 'APForce — WhatsApp CRM for AP & Sub-Brokers',
    description: PRODUCT_DESCRIPTION,
    url: 'https://apforce.in',
    siteName: 'APForce',
    locale: 'en_IN',
    type: 'website',
  },
};

const FEATURES = [
  {
    label: 'Inbox',
    title: 'WhatsApp Inbox',
    body: 'Every conversation your desk has on WhatsApp — new leads, existing clients, KYC follow-ups — in one shared inbox your whole team can see and act on.',
  },
  {
    label: 'Pipeline',
    title: 'CRM Pipeline',
    body: 'Track a lead from first message to funded account. Stages, ownership, and follow-up reminders built around how an AP desk actually works, not a generic sales funnel.',
  },
  {
    label: 'Automation',
    title: 'Automation',
    body: 'Welcome replies, working-hours messages, and multi-step workflows that fire on triggers like a new lead or a stage change — so nobody waits on a reply.',
  },
  {
    label: 'Templates',
    title: 'Message Templates',
    body: 'Pre-approved WhatsApp templates for KYC reminders, onboarding steps, and compliance-sensitive messages, ready to send in one tap.',
  },
];

const FOOTER_LINKS = [
  { href: 'https://app.apforce.in/privacy-policy', label: 'Privacy Policy' },
  { href: 'https://app.apforce.in/terms', label: 'Terms of Service' },
  { href: 'https://app.apforce.in/data-deletion', label: 'Data Deletion' },
];

export default function MarketingPage() {
  return (
    <div className={`${display.variable} ${body.variable} ${mono.variable} bg-[#10192B]`} style={{ fontFamily: 'var(--font-body)' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#10192B]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#B8863C] text-sm font-bold text-[#10192B]">A</span>
            <span className="text-[17px] font-semibold tracking-tight text-white">APForce</span>
          </Link>
          <a
            href="https://app.apforce.in"
            className="rounded-full bg-[#B8863C] px-5 py-2 text-sm font-semibold text-[#10192B] transition hover:bg-[#c9944a]"
          >
            Log in
          </a>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pb-24 pt-16 sm:pt-24">
        <div className="mx-auto grid max-w-6xl gap-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p
              className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#D9B36C]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              WhatsApp CRM · Built for AP &amp; Sub-Brokers
            </p>
            <h1
              className="mt-5 text-balance text-[40px] font-normal leading-[1.08] text-white sm:text-[52px]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Every client conversation,
              <br />
              <span className="italic text-[#D9B36C]">on the number they already trust.</span>
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-7 text-[#AEB9C9]">
              {PRODUCT_DESCRIPTION}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a
                href="https://app.apforce.in"
                className="rounded-full bg-[#B8863C] px-7 py-3 text-[15px] font-semibold text-[#10192B] transition hover:bg-[#c9944a]"
              >
                Log in to your desk
              </a>
              <a
                href="#features"
                className="text-[15px] font-medium text-[#D7DEE8] underline decoration-white/25 decoration-1 underline-offset-4 transition hover:decoration-white/60"
              >
                See what it does ↓
              </a>
            </div>
          </div>

          {/* Abstracted WhatsApp-thread motif — geometric, not a screenshot */}
          <div aria-hidden className="relative mx-auto h-[320px] w-full max-w-sm sm:h-[360px]">
            <div className="absolute left-0 top-4 w-[78%] -rotate-2 rounded-2xl rounded-bl-sm bg-white/[0.06] p-4 shadow-lg ring-1 ring-white/10 backdrop-blur">
              <div className="h-2.5 w-2/3 rounded-full bg-white/25" />
              <div className="mt-2 h-2.5 w-5/6 rounded-full bg-white/15" />
            </div>
            <div className="absolute right-0 top-[122px] w-[70%] rotate-1 rounded-2xl rounded-br-sm bg-[#B8863C]/90 p-4 shadow-lg">
              <div className="h-2.5 w-3/4 rounded-full bg-[#10192B]/30" />
              <div className="mt-2 h-2.5 w-1/2 rounded-full bg-[#10192B]/20" />
            </div>
            <div className="absolute left-4 top-[236px] w-[66%] -rotate-1 rounded-2xl rounded-bl-sm bg-[#25D366]/90 p-4 shadow-lg">
              <div className="h-2.5 w-2/3 rounded-full bg-[#10192B]/25" />
            </div>
          </div>
        </div>
      </section>

      {/* ── What it does ───────────────────────────────────────────────── */}
      <section className="bg-[#EEF2F6] px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7A8E]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            What APForce does
          </p>
          <p
            className="mt-5 text-balance text-[26px] font-normal leading-[1.35] text-[#10192B] sm:text-[30px]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            A CRM built around your WhatsApp Business Account — not a bolt-on chat widget inside someone else&apos;s software.
          </p>
          <p className="mx-auto mt-6 max-w-xl text-[16px] leading-7 text-[#4A5568]">
            Connect your own number once. Every contact, conversation, and automated message runs through it —
            your clients keep messaging the number they&apos;ve already saved, and your team gets the pipeline,
            reminders, and templates to run the desk properly.
          </p>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────── */}
      <section id="features" className="bg-[#EEF2F6] px-6 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-px overflow-hidden rounded-2xl bg-[#D3D9E0] sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-[#F8FAFB] p-8">
                <span
                  className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#B8863C]"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {f.label}
                </span>
                <h3
                  className="mt-3 text-[21px] font-medium text-[#10192B]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {f.title}
                </h3>
                <p className="mt-2.5 max-w-md text-[15px] leading-6 text-[#4A5568]">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Who it's for ───────────────────────────────────────────────── */}
      <section className="bg-[#1B3A6B] px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9FB3D6]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Who it&apos;s for
          </p>
          <p
            className="mt-5 text-balance text-[26px] font-normal leading-[1.35] text-white sm:text-[30px]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Authorized Persons and Sub-Brokers running their own client base.
          </p>
          <p className="mx-auto mt-6 max-w-xl text-[16px] leading-7 text-[#C3D0E4]">
            You bring the client relationships and the trading floor experience. APForce brings the system to run
            them — built for a desk of one to a small team, not an enterprise IT rollout.
          </p>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="bg-[#10192B] px-6 py-20 text-center">
        <p
          className="text-balance text-[26px] font-normal leading-tight text-white sm:text-[30px]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Already on APForce?
        </p>
        <a
          href="https://app.apforce.in"
          className="mt-7 inline-block rounded-full bg-[#B8863C] px-8 py-3 text-[15px] font-semibold text-[#10192B] transition hover:bg-[#c9944a]"
        >
          Log in to your desk
        </a>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 bg-[#10192B] px-6 py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#B8863C] text-xs font-bold text-[#10192B]">A</span>
              <span className="text-[15px] font-semibold text-white">APForce</span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-6 text-[#8492A6]" style={{ fontFamily: 'var(--font-mono)' }}>
              Sector No 34, 1st Main, 2nd Cross,
              <br />
              Navanagar, Bagalkot, Karnataka 587103
            </p>
          </div>

          <div className="flex flex-col gap-2 text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>
            <a href="mailto:support@apforce.in" className="text-[#C3CDDB] hover:text-white">support@apforce.in</a>
            <a href="tel:+919901251785" className="text-[#C3CDDB] hover:text-white">+91 99012 51785</a>
          </div>

          <nav className="flex flex-col gap-2 text-[13px]">
            {FOOTER_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-[#C3CDDB] hover:text-white">
                {l.label}
              </a>
            ))}
          </nav>
        </div>
        <p className="mx-auto mt-10 max-w-6xl text-[12px] text-[#5C697E]" style={{ fontFamily: 'var(--font-mono)' }}>
          © {new Date().getFullYear()} Viir Trading. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
