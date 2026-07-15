import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";

import type { PostMeta } from "@/lib/content/types";

type SeriesPostListProps = {
  posts: PostMeta[];
};

export default function SeriesPostList({ posts }: SeriesPostListProps) {
  return (
    <section aria-labelledby="series-posts-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-sky-700">学习路径</p>
          <h2
            className="mt-1 text-xl font-semibold tracking-normal text-slate-950"
            id="series-posts-heading"
          >
            按顺序学习
          </h2>
        </div>
      </div>

      <ol className="flex flex-col gap-2">
        {posts.map((post, index) => {
          const isFirst = index === 0;

          return (
            <li key={post.slug}>
              <Link
                className={[
                  "group grid gap-3 rounded-[8px] border bg-white/94 p-3.5 shadow-sm transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:items-center sm:p-4",
                  isFirst
                    ? "border-sky-200 shadow-sky-100 hover:border-sky-300 hover:shadow-lg hover:shadow-sky-100"
                    : "border-slate-200 shadow-slate-200/70 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-100",
                ].join(" ")}
                href={`/posts/${post.slug}`}
              >
                <span
                  className={[
                    "flex h-10 w-10 items-center justify-center rounded-[8px] text-sm font-semibold tabular-nums",
                    isFirst ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600",
                  ].join(" ")}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>

                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    {isFirst ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                        置顶
                      </span>
                    ) : null}
                    <span className="text-base font-semibold leading-6 text-slate-950 sm:text-lg">
                      {post.title}
                    </span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
                      {post.readMinutes} 分钟
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {post.tags.map((tag) => (
                        <span
                          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  </span>
                </span>

                <span className="inline-flex items-center gap-2 text-sm font-semibold text-sky-700 sm:justify-self-end">
                  阅读
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
