import type { Series } from "@/lib/content/types";

type SeriesHeaderProps = {
  postCount: number;
  series: Series;
};

export default function SeriesHeader({ postCount, series }: SeriesHeaderProps) {
  return (
    <section className="rounded-[8px] border border-slate-200 bg-white/92 p-4 shadow-sm shadow-slate-200/70 sm:p-8 lg:p-10">
      <div className="flex flex-col gap-4 sm:gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3 sm:gap-5">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border border-slate-200 bg-slate-50 text-3xl shadow-inner shadow-white sm:h-16 sm:w-16 sm:text-4xl"
          >
            {series.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-sky-700">系列</p>
            <h1 className="mt-1.5 text-balance text-2xl font-semibold tracking-normal text-slate-950 sm:mt-3 sm:text-5xl">
              {series.title}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:mt-4 sm:text-lg sm:leading-7">
              {series.description}
            </p>
          </div>
        </div>
        <div className="shrink-0 self-start rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 sm:px-4 sm:py-3">
          0/{postCount} 篇已学习
        </div>
      </div>

      <div className="mt-5 sm:mt-8" aria-label={`学习进度 0%，共 ${postCount} 篇`}>
        <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-600">
          <span>学习进度</span>
          <span>0%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
          <div className="h-full w-0 rounded-full bg-emerald-500" />
        </div>
      </div>
    </section>
  );
}
