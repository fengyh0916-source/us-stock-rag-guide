import { Compass } from "lucide-react";

export default function HomeHero() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center text-center">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-sky-800 shadow-sm shadow-sky-100/70 sm:mb-7 sm:px-4 sm:py-2 sm:text-sm">
        <Compass aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        新手投资路线图
      </div>
      <h1 className="max-w-4xl text-balance text-[1.75rem] font-semibold leading-tight tracking-normal text-slate-950 sm:text-5xl sm:leading-none lg:text-6xl">
        美股 & 港卡投资一站式导航
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-[15px] leading-7 text-slate-600 sm:mt-6 sm:text-xl sm:leading-8">
        开港卡、选券商、入金出金、买第一只 ETF，看完教程就能开始。
      </p>
    </section>
  );
}
