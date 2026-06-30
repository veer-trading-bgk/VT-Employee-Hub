import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // V2 → V3 route redirects (preserve backward compatibility)
      // Employee routes → V3 My Work
      { source: '/employee/dashboard', destination: '/home', permanent: false },
      { source: '/employee/crm',       destination: '/sales', permanent: false },
      // Admin routes → V3 equivalents
      { source: '/admin/dashboard',    destination: '/home',          permanent: false },
      { source: '/admin/contacts',     destination: '/customers',     permanent: false },
      { source: '/admin/analytics',    destination: '/analytics',     permanent: false },
      // The /admin/whatsapp route is KEPT for backward compatibility (V2 employees still use it)
      // Manager routes
      { source: '/manager/dashboard',  destination: '/home',          permanent: false },
    ];
  },
};

export default nextConfig;

// build: ws-env
