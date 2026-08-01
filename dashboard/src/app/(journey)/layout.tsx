/**
 * Public Journey route group — deliberately outside (v3).
 * No ProtectedRoute, no V3Sidebar, no dashboard chrome.
 * Capability URLs: /journey/:companyId/:journeyInstanceId/:token
 * (route group name does not appear in the URL).
 */
export default function JourneyPublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
