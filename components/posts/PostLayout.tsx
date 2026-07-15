import Link from "next/link";
import { BookOpen, CheckCircle2, ChevronRight, Clock3 } from "lucide-react";

import type { Post, PostMeta, Series } from "@/lib/content/types";

import PostToc from "./PostToc";

type PostLayoutProps = {
  post: Post;
  series: Series;
  siblingPosts: PostMeta[];
};

export default function PostLayout({ post, series, siblingPosts }: PostLayoutProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-5 py-6 sm:gap-7 sm:py-10 lg:py-12">
      <nav
        aria-label="面包屑"
        className="flex min-w-0 flex-wrap items-center gap-1 text-xs font-medium text-slate-500 sm:gap-1.5 sm:text-sm"
      >
        <Link className="hidden rounded px-1 py-0.5 hover:text-sky-700 sm:inline" href="/">
          文字教程
        </Link>
        <ChevronRight
          aria-hidden="true"
          className="hidden h-4 w-4 shrink-0 text-slate-300 sm:inline"
        />
        <Link
          className="max-w-[40%] truncate rounded px-1 py-0.5 hover:text-sky-700 sm:max-w-none"
          href={`/series/${series.slug}`}
        >
          {series.title}
        </Link>
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-300 sm:h-4 sm:w-4" />
        <span
          aria-current="page"
          className="min-w-0 flex-1 truncate px-1 py-0.5 text-slate-700 sm:flex-none"
        >
          {post.title}
        </span>
      </nav>

      <div aria-label="阅读进度 0%" className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
        <div className="h-full w-0 rounded-full bg-emerald-500" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[14.5rem_minmax(0,1fr)] xl:grid-cols-[14.5rem_minmax(0,1fr)_15rem] 2xl:grid-cols-[15.5rem_minmax(0,1fr)_16rem] 2xl:gap-6">
        <aside className="order-2 lg:order-1">
          <div className="rounded-[8px] border border-slate-200 bg-white/94 p-4 shadow-sm shadow-slate-200/70 lg:sticky lg:top-6">
            <div className="mb-4 flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-slate-100 text-2xl"
              >
                {series.icon}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-normal text-sky-700">系列</p>
                <h2 className="mt-1 text-base font-semibold leading-6 text-slate-950">{series.title}</h2>
              </div>
            </div>

            <ol className="flex flex-col gap-2">
              {siblingPosts.map((sibling, index) => {
                const isCurrent = sibling.slug === post.slug;

                return (
                  <li key={sibling.slug}>
                    <Link
                      aria-current={isCurrent ? "page" : undefined}
                      className={[
                        "grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-[8px] border px-3 py-3 text-sm transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
                        isCurrent
                          ? "border-sky-200 bg-sky-50 text-sky-900"
                          : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950",
                      ].join(" ")}
                      href={`/posts/${sibling.slug}`}
                    >
                      <span
                        className={[
                          "flex h-7 w-7 items-center justify-center rounded-[8px] text-xs font-semibold tabular-nums",
                          isCurrent ? "bg-white text-sky-700" : "bg-slate-100 text-slate-500",
                        ].join(" ")}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-wrap font-semibold leading-5">{sibling.title}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                          {isCurrent ? (
                            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
                          )}
                          {sibling.readMinutes} 分钟
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        <article className="order-1 min-w-0 rounded-[8px] border border-slate-200 bg-white/96 shadow-sm shadow-slate-200/70 lg:order-2">
          <header className="border-b border-slate-200 px-4 py-5 sm:px-8 sm:py-9 lg:px-10">
            <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700">
                <BookOpen aria-hidden="true" className="h-4 w-4" />
                {series.title}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 aria-hidden="true" className="h-4 w-4" />
                {post.readMinutes} 分钟
              </span>
            </div>
            <h1 className="max-w-none text-xl font-semibold leading-[1.25] tracking-normal text-slate-950 sm:text-3xl lg:text-4xl">
              {post.title}
            </h1>
            <div className="mt-5 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
                  key={tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          </header>

          <div className="mx-4 mt-5 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950 sm:mx-8 sm:mt-7 lg:mx-10">
            <p className="font-semibold">阅读前请注意</p>
            <p className="mt-1">
              本文仅记录科普与操作经验，不构成投资、税务、法律或开户资格建议。平台规则、地区政策和费用可能随时变化，请在操作前核对官方信息。文中可能包含推荐链接，运营者可能获得平台奖励。
            </p>
          </div>

          <div
            className="article-prose min-w-0 overflow-x-auto px-4 py-5 text-[0.98rem] leading-7 text-slate-700 sm:px-8 sm:py-9 sm:text-[1.02rem] sm:leading-8 lg:px-10"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />

          <footer className="border-t border-slate-200 px-5 py-6 sm:px-8 lg:px-10">
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-medium leading-6 text-amber-900">
              本内容仅供科普参考，不构成投资、税务或法律建议。
            </div>
          </footer>
        </article>

        <aside className="order-3 xl:order-3">
          <div className="rounded-[8px] border border-slate-200 bg-white/94 p-4 shadow-sm shadow-slate-200/70 xl:sticky xl:top-6">
            <h2 className="mb-3 text-sm font-semibold text-slate-950">目录</h2>
            <PostToc headings={post.headings} />
          </div>
        </aside>
      </div>
    </div>
  );
}
