"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { trackProductEvent } from "@/lib/analytics/client";
import type { ProductEventProperties } from "@/lib/analytics/types";

function pageType(pathname: string): ProductEventProperties["page_type"] {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/series/")) return "series";
  if (pathname.startsWith("/posts/")) return "post";
  if (pathname.startsWith("/tools/")) return "tool";
  return "other";
}

function initialSource(): string {
  if (typeof document === "undefined" || !document.referrer) return "direct";
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin
      ? "internal"
      : referrer.hostname.slice(0, 40);
  } catch {
    return "other";
  }
}

export default function PageViewTracker() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    if (lastTrackedPath.current === pathname) return;

    const source = lastTrackedPath.current ? "internal" : initialSource();
    lastTrackedPath.current = pathname;
    trackProductEvent("page_view", {
      page_type: pageType(pathname),
      page_slug: pathname,
      source,
    });
  }, [pathname]);

  return null;
}
