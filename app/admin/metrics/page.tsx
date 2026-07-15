import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Activity,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  MessageSquareText,
  MousePointerClick,
  UsersRound,
} from "lucide-react";

import { isAnalyticsAdmin } from "@/lib/analytics/admin";
import { getAnalyticsDashboard } from "@/lib/analytics/server";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ days?: string }>;
};

function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function shortDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function pageLabel(pathname: string): string {
  if (pathname === "/") return "首页";
  if (pathname === "/tools/asset-tracker") return "个人资产管理看板";
  return pathname;
}

export default async function MetricsPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!isAnalyticsAdmin(user)) notFound();

  const params = await searchParams;
  const requestedDays = Number(params.days || "30");
  const days = requestedDays === 7 || requestedDays === 90 ? requestedDays : 30;
  const result = await getAnalyticsDashboard(days);
  const { summary, daily, top_pages: topPages } = result.data;
  const maxDailyPageViews = Math.max(1, ...daily.map((point) => point.page_views));
  const maxDailyQuestions = Math.max(1, ...daily.map((point) => point.questions));
  const maxTopPageViews = Math.max(1, ...topPages.map((page) => page.page_views));

  const trafficCards = [
    {
      label: `最近 ${days} 天 PV`,
      value: summary.page_views.toLocaleString("zh-CN"),
      note: "页面加载与站内页面切换次数",
      icon: Eye,
      tone: "text-cyan-300",
    },
    {
      label: `最近 ${days} 天 UV`,
      value: summary.visitors.toLocaleString("zh-CN"),
      note: "登录用户去重；游客按天匿名去重",
      icon: UsersRound,
      tone: "text-emerald-300",
    },
    {
      label: "今日 PV",
      value: summary.today_page_views.toLocaleString("zh-CN"),
      note: "UTC+0 自然日内的页面访问",
      icon: CalendarDays,
      tone: "text-sky-300",
    },
    {
      label: "今日 UV",
      value: summary.today_visitors.toLocaleString("zh-CN"),
      note: "UTC+0 当日匿名访客去重",
      icon: UsersRound,
      tone: "text-amber-300",
    },
  ];

  const agentCards = [
    {
      label: "提问次数",
      value: summary.questions.toLocaleString("zh-CN"),
      note: `打开助手后提问率 ${percent(summary.questions, summary.agent_opens)}`,
      icon: MessageSquareText,
      tone: "text-sky-300",
    },
    {
      label: "回答成功率",
      value: percent(summary.answer_successes, summary.answer_successes + summary.answer_failures),
      note: `${summary.answer_successes} 次成功 · ${summary.answer_failures} 次失败`,
      icon: CheckCircle2,
      tone: "text-emerald-300",
    },
    {
      label: "P95 回答耗时",
      value: duration(summary.p95_latency_ms),
      note: `平均 ${duration(summary.avg_latency_ms)}`,
      icon: Clock3,
      tone: "text-amber-300",
    },
    {
      label: "活跃产品访客",
      value: summary.active_actors.toLocaleString("zh-CN"),
      note: "产生过访问或产品行为的访客",
      icon: Activity,
      tone: "text-cyan-300",
    },
  ];

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-[#07111f] text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b1727] p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-emerald-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
                Product signal room
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                产品数据看板
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
                同时观察网站流量与 Agent 使用质量。PV、UV、热门页面和核心行为均由站内匿名埋点采集，并在 Supabase 聚合展示。
              </p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100">
              <Database className="h-4 w-4" aria-hidden />
              Supabase 自有口径
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="font-mono text-xs text-slate-500">UTC+0 数据 · 最近 {days} 天</p>
          <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-1">
            {[7, 30, 90].map((value) => (
              <Link
                key={value}
                href={`/admin/metrics?days=${value}`}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  days === value
                    ? "bg-white text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {value} 天
              </Link>
            ))}
          </div>
        </div>

        {!result.configured || result.error ? (
          <section className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-5 text-sm leading-6 text-amber-100">
            <p className="font-semibold">数据仓库尚未就绪</p>
            <p className="mt-1 text-amber-100/70">
              {!result.configured
                ? "请先配置 Supabase 环境变量，并在 SQL Editor 执行 supabase/analytics.sql。"
                : "已连接 Supabase，但聚合函数不可用。请重新执行 supabase/analytics.sql。"}
            </p>
          </section>
        ) : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="核心指标">
          {trafficCards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.label}
                className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-400">{card.label}</p>
                  <Icon className={`h-4 w-4 ${card.tone}`} aria-hidden />
                </div>
                <p className="mt-5 font-mono text-3xl font-semibold tracking-[-0.05em] text-white">
                  {card.value}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">{card.note}</p>
              </article>
            );
          })}
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.55fr_0.85fr]">
          <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Activity className="h-4 w-4 text-cyan-300" aria-hidden />
                  每日访问趋势
                </div>
                <p className="mt-1 text-xs text-slate-500">蓝色为 PV，绿色为当日 UV</p>
              </div>
              <span className="font-mono text-xs text-slate-500">PV / UV</span>
            </div>

            {daily.length > 0 ? (
              <div className="mt-8 flex h-56 items-end gap-1.5 sm:gap-2" aria-label="每日访问柱状图">
                {daily.map((point) => {
                  const height = Math.max(8, Math.round((point.page_views / maxDailyPageViews) * 100));
                  const visitorRatio = point.page_views > 0 ? point.visitors / point.page_views : 0;
                  return (
                    <div
                      key={point.day}
                      className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
                      title={`${point.day}：PV ${point.page_views}，UV ${point.visitors}`}
                    >
                      <span className="hidden font-mono text-[10px] text-slate-500 group-hover:block sm:block">
                        {point.page_views}
                      </span>
                      <div
                        className="relative w-full max-w-8 overflow-hidden rounded-t-md bg-cyan-300/75 transition group-hover:brightness-125"
                        style={{ height: `${height}%` }}
                      >
                        <div
                          className="absolute inset-x-0 bottom-0 bg-emerald-300/85"
                          style={{ height: `${Math.round(visitorRatio * 100)}%` }}
                        />
                      </div>
                      <span className="max-w-full truncate font-mono text-[9px] text-slate-600 sm:text-[10px]">
                        {shortDay(point.day)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-8 flex h-56 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-600">
                产生页面访问后，这里会出现 PV / UV 趋势
              </div>
            )}
          </article>

          <article className="rounded-3xl border border-white/10 bg-[#0d1b2c] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Eye className="h-4 w-4 text-emerald-300" aria-hidden />
                热门页面
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Top 8</span>
            </div>

            {topPages.length > 0 ? (
              <div className="mt-6 space-y-4">
                {topPages.map((page, index) => (
                  <div key={page.page}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-600">{String(index + 1).padStart(2, "0")}</span>
                        <span className="truncate text-xs text-slate-300" title={page.page}>
                          {pageLabel(page.page)}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-slate-500">
                        {page.page_views} PV · {page.visitors} UV
                      </span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300"
                        style={{ width: `${Math.max(3, (page.page_views / maxTopPageViews) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 flex h-56 items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-sm leading-6 text-slate-600">
                页面访问积累后，这里会显示最受关注的内容
              </div>
            )}
          </article>
        </section>

        <div className="mt-10 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">Agent quality</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Agent 核心指标">
          {agentCards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.label}
                className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-400">{card.label}</p>
                  <Icon className={`h-4 w-4 ${card.tone}`} aria-hidden />
                </div>
                <p className="mt-4 font-mono text-2xl font-semibold tracking-[-0.04em] text-white">{card.value}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">{card.note}</p>
              </article>
            );
          })}
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.55fr_0.85fr]">
          <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Activity className="h-4 w-4 text-cyan-300" aria-hidden />
                  每日提问趋势
                </div>
                <p className="mt-1 text-xs text-slate-500">绿色为成功回答，红色为失败</p>
              </div>
              <span className="font-mono text-xs text-slate-500">Q / DAY</span>
            </div>

            {daily.length > 0 ? (
              <div className="mt-8 flex h-56 items-end gap-1.5 sm:gap-2" aria-label="每日提问柱状图">
                {daily.map((point) => {
                  const height = Math.max(8, Math.round((point.questions / maxDailyQuestions) * 100));
                  const successRatio = point.questions > 0 ? point.successes / point.questions : 0;
                  return (
                    <div
                      key={point.day}
                      className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
                      title={`${point.day}：${point.questions} 次提问，${point.successes} 次成功，${point.failures} 次失败`}
                    >
                      <span className="hidden font-mono text-[10px] text-slate-500 group-hover:block sm:block">
                        {point.questions}
                      </span>
                      <div
                        className="relative w-full max-w-8 overflow-hidden rounded-t-md bg-rose-400/55 transition group-hover:brightness-125"
                        style={{ height: `${height}%` }}
                      >
                        <div
                          className="absolute inset-x-0 bottom-0 bg-emerald-300/80"
                          style={{ height: `${Math.round(successRatio * 100)}%` }}
                        />
                      </div>
                      <span className="max-w-full truncate font-mono text-[9px] text-slate-600 sm:text-[10px]">
                        {shortDay(point.day)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-8 flex h-56 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-600">
                上线并产生访问后，这里会出现趋势图
              </div>
            )}
          </article>

          <article className="rounded-3xl border border-white/10 bg-[#0d1b2c] p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Bot className="h-4 w-4 text-emerald-300" aria-hidden />
              Agent 漏斗
            </div>
            <div className="mt-6 space-y-5">
              {[
                ["打开助手", summary.agent_opens, "100%"],
                ["提交问题", summary.questions, percent(summary.questions, summary.agent_opens)],
                ["成功回答", summary.answer_successes, percent(summary.answer_successes, summary.questions)],
                ["点击相关文章", summary.related_clicks, percent(summary.related_clicks, summary.answer_successes)],
              ].map(([label, value, ratio], index) => (
                <div key={String(label)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-slate-300">{label}</span>
                    <span className="font-mono text-xs text-slate-500">
                      {Number(value).toLocaleString("zh-CN")} · {ratio}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full ${index === 3 ? "bg-amber-300" : "bg-cyan-300"}`}
                      style={{
                        width: index === 0
                          ? "100%"
                          : `${Math.max(2, Math.min(100, summary.agent_opens > 0 ? (Number(value) / summary.agent_opens) * 100 : 0))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 border-t border-white/10 pt-5">
              <div>
                <p className="text-xs text-slate-500">用户反馈</p>
                <p className="mt-1 font-mono text-xl text-white">{summary.feedback_total}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">好评率</p>
                <p className="mt-1 font-mono text-xl text-emerald-300">
                  {percent(summary.helpful_feedback, summary.feedback_total)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">注册人数</p>
                <p className="mt-1 font-mono text-xl text-white">{summary.signups}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">签到次数</p>
                <p className="mt-1 font-mono text-xl text-white">{summary.checkins}</p>
              </div>
            </div>
          </article>
        </section>

        <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <p>这里只保存匿名行为指标与页面路径，不保存问题原文、邮箱、IP 或持仓。PV / UV 由 Supabase 聚合，无需进入 Vercel 查看。</p>
          </div>
          <Link href="/privacy" className="shrink-0 font-semibold text-slate-300 hover:text-white">
            查看隐私说明
          </Link>
        </section>
      </div>
    </main>
  );
}
