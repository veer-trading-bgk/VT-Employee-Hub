import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { QueryProvider } from "@/providers/QueryProvider";
import { AssignmentBridgeProvider } from "@/providers/AssignmentBridgeProvider";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { Toaster } from "sonner";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "APForce",
  description: "AP & Sub-Broker Performance Platform",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "APForce",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2563EB",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* Runs before React hydrates — prevents dark/light flash on first load */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('vt-theme');document.documentElement.classList.toggle('dark',t!=='light')}catch(e){document.documentElement.classList.add('dark')}` }} />
      </head>
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950">
        <QueryProvider>
          <AssignmentBridgeProvider>
            <ThemeProvider>
              <AuthProvider>
                <WebSocketProvider>
                  <ErrorBoundary>{children}</ErrorBoundary>
                  <Toaster richColors position="top-right" offset="4.5rem" />
                  <ServiceWorkerRegister />
                </WebSocketProvider>
              </AuthProvider>
            </ThemeProvider>
          </AssignmentBridgeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
