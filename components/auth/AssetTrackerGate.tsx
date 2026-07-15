"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ShieldCheck, WalletCards } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { trackProductEvent } from "@/lib/analytics/client";

export default function AssetTrackerGate() {
  const { user, loading, requireAuth } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }
    if (user) {
      trackProductEvent("asset_tracker_opened", {
        page_type: "tool",
        page_slug: "asset-tracker",
        source: "authenticated_redirect",
      });
      window.location.replace("/asset-tracker/index.html");
      return;
    }
    requireAuth("asset-tracker", () => {
      trackProductEvent("asset_tracker_opened", {
        page_type: "tool",
        page_slug: "asset-tracker",
        source: "login_gate",
      });
      window.location.replace("/asset-tracker/index.html");
    });
  }, [loading, user, requireAuth]);

  return (
    <main className="bg-dot-grid min-h-[calc(100vh-3.5rem)] px-5 py-16 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white/95 p-8 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <WalletCards className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">个人资产管理看板</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          资产数据属于个人隐私。请先登录后再进入看板。教程与系列文章仍可匿名阅读。
        </p>
        <ul className="mt-5 space-y-2 text-sm text-slate-600">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            登录后才能查看与编辑持仓
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            浏览开港卡 / 券商 / 出入金教程无需账号
          </li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
            onClick={() =>
              requireAuth("asset-tracker", () => {
                trackProductEvent("asset_tracker_opened", {
                  page_type: "tool",
                  page_slug: "asset-tracker",
                  source: "login_button",
                });
                window.location.replace("/asset-tracker/index.html");
              })
            }
          >
            登录后进入
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
