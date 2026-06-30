import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Customers → Contacts rename (308 permanent so clients cache them)
      { source: '/customers',           destination: '/contacts',           permanent: true },
      { source: '/customers/:path*',    destination: '/contacts/:path*',    permanent: true },

      // Legacy V2 deep-link redirects — 308 permanent so clients cache them
      { source: '/employee/dashboard',       destination: '/home',          permanent: true },
      { source: '/employee/crm',             destination: '/sales',         permanent: true },
      { source: '/employee/daily-entry',     destination: '/entry',         permanent: true },
      { source: '/employee/attendance',      destination: '/attendance',    permanent: true },
      { source: '/employee/compensation',    destination: '/compensation',  permanent: true },
      { source: '/employee/achievements',    destination: '/home',          permanent: true },
      { source: '/admin/dashboard',          destination: '/home',          permanent: true },
      { source: '/admin/contacts',           destination: '/contacts',      permanent: true },
      { source: '/admin/analytics',          destination: '/analytics',     permanent: true },
      { source: '/admin/bulk-entry',         destination: '/entry',         permanent: true },
      { source: '/admin/attendance',         destination: '/attendance',    permanent: true },
      { source: '/admin/compensation',       destination: '/compensation',  permanent: true },
      { source: '/admin/targets',            destination: '/settings',      permanent: true },
      { source: '/admin/audit',              destination: '/settings',      permanent: true },
      { source: '/admin/whatsapp',           destination: '/communications',permanent: true },
      { source: '/admin/whatsapp/broadcast', destination: '/communications',permanent: true },
      { source: '/admin/whatsapp/templates', destination: '/communications',permanent: true },
      { source: '/manager/dashboard',        destination: '/home',          permanent: true },
      { source: '/manager/attendance',       destination: '/attendance',    permanent: true },
      { source: '/manager/bulk-entry',       destination: '/entry',         permanent: true },
      { source: '/team-lead/add-entry',      destination: '/entry',         permanent: true },
      { source: '/leaderboard',              destination: '/analytics',     permanent: true },
      { source: '/profile',                  destination: '/settings',      permanent: true },
      { source: '/dashboard',               destination: '/home',          permanent: true },
    ];
  },
};

export default nextConfig;

// build: ws-env
