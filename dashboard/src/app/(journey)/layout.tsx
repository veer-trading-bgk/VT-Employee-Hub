/**
 * Public Journey route group — deliberately outside (v3).
 * No ProtectedRoute, no V3Sidebar, no dashboard chrome.
 * Capability URLs: /journey/:companyId/:journeyInstanceId/:token
 * (route group name does not appear in the URL).
 *
 * LightShell: pins color-scheme + clears html.dark for this visit so v3
 * Input/Select stay readable on customer phones (see JourneyPublicLightShell).
 */
import { JourneyPublicLightShell } from './JourneyPublicLightShell';

export default function JourneyPublicLayout({ children }: { children: React.ReactNode }) {
  return <JourneyPublicLightShell>{children}</JourneyPublicLightShell>;
}
