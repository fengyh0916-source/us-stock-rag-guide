"use client";

import Link from "next/link";
import { BarChart3, LogIn, LogOut, UserRound } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";

export default function SiteHeader() {
  const { user, loading, openLogin, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:h-14 sm:gap-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-950 transition hover:text-sky-700"
        >
          美股扫盲导航
        </Link>

        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-slate-400">…</span>
          ) : user ? (
            <>
              {user.isAdmin ? (
                <Link
                  href="/admin/metrics"
                  className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
                >
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">数据看板</span>
                </Link>
              ) : null}
              <span className="hidden max-w-[10rem] truncate text-sm text-slate-600 sm:inline">
                {user.displayName}
              </span>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-50 text-sky-700 ring-1 ring-sky-100 sm:hidden">
                <UserRound className="h-4 w-4" aria-hidden />
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                退出
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => openLogin("general")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#0d0d0d] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black sm:px-3.5"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden />
              登录/注册
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
