"use client";

import type { ReactNode } from "react";

import PageViewTracker from "@/components/analytics/PageViewTracker";
import { AuthProvider } from "@/components/auth/AuthProvider";
import LoginModal from "@/components/auth/LoginModal";
import SiteHeader from "@/components/auth/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PageViewTracker />
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </div>
      <LoginModal />
    </AuthProvider>
  );
}
