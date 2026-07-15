"use client";

import { ArrowUpRight, WalletCards } from "lucide-react";

import RequireAuthLink from "@/components/auth/RequireAuthLink";

export default function RelatedTools() {
  return (
    <section aria-labelledby="related-tools-heading" className="mx-auto w-full max-w-5xl">
      <div className="mb-5">
        <p className="text-sm font-semibold text-sky-700">实用工具</p>
        <h2
          id="related-tools-heading"
          className="mt-2 text-2xl font-semibold tracking-normal text-slate-950"
        >
          相关工具
        </h2>
      </div>

      <RequireAuthLink
        reason="asset-tracker"
        href="/tools/asset-tracker"
        className="group flex items-start gap-3 rounded-[8px] border border-slate-200 bg-white/88 p-4 shadow-sm shadow-slate-200/70 transition duration-200 active:scale-[0.99] hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500 sm:gap-5 sm:p-6"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-emerald-50 text-emerald-700 sm:h-11 sm:w-11">
          <WalletCards aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-base font-semibold leading-6 text-slate-950 sm:text-lg sm:leading-7">
            个人资产管理看板
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-100">
              需登录
            </span>
            <ArrowUpRight
              aria-hidden="true"
              className="h-4 w-4 text-emerald-700 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </span>
          <span className="mt-2 block text-sm leading-6 text-slate-600">
            美股 / A 股 / 现金多账户汇总，实时行情与盈亏看板。登录后进入，保护你的持仓隐私。
          </span>
          <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 sm:mt-5">
            登录后打开看板
          </span>
        </span>
      </RequireAuthLink>
    </section>
  );
}
