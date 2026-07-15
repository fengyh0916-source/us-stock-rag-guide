import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import AuthShell from "@/components/auth/AuthShell";

import "./globals.css";

export const metadata: Metadata = {
  title: "美股扫盲导航",
  description: "面向新手的美股与港卡投资学习导航"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7fbff",
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Immersive Translate)
    // inject attributes like data-immersive-translate-page-theme onto <html>/<body>
    // before React hydrates, which would otherwise spam recoverable hydration errors.
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthShell>{children}</AuthShell>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
