import Link from "next/link";
import { ArrowRight, BadgeDollarSign, Banknote, CreditCard } from "lucide-react";

const tasks = [
  {
    title: "我要开港卡",
    href: "/series/hk-banks",
    description: "梳理开户准备、银行选择和常见审核问题。",
    icon: CreditCard,
    accent: "text-sky-700",
    bg: "bg-sky-50"
  },
  {
    title: "我要炒美股",
    href: "/series/us-brokers",
    description: "从券商入门到第一只 ETF，按步骤推进。",
    icon: BadgeDollarSign,
    accent: "text-emerald-700",
    bg: "bg-emerald-50"
  },
  {
    title: "我要出入金",
    href: "/series/fund-transfer",
    description: "理解跨境汇款、换汇路径和资金回流。",
    icon: Banknote,
    accent: "text-amber-700",
    bg: "bg-amber-50"
  }
] as const;

export default function TaskCards() {
  return (
    <section aria-labelledby="task-cards-heading">
      <h2 id="task-cards-heading" className="sr-only">
        投资任务入口
      </h2>
      <div className="grid gap-3 sm:gap-5 md:grid-cols-3">
        {tasks.map(({ title, href, description, icon: Icon, accent, bg }) => (
          <Link
            className="group flex min-h-0 flex-col justify-between rounded-[8px] border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/70 transition duration-200 active:scale-[0.99] hover:-translate-y-1 hover:border-sky-300 hover:shadow-xl hover:shadow-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500 sm:min-h-64 sm:p-7"
            href={href}
            key={href}
          >
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-[8px] sm:h-12 sm:w-12 ${bg} ${accent}`}
            >
              <Icon aria-hidden="true" className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <span className="mt-4 block sm:mt-8">
              <span className="block text-xl font-semibold tracking-normal text-slate-950 sm:text-2xl">
                {title}
              </span>
              <span className="mt-2 block text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base sm:leading-7">
                {description}
              </span>
            </span>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-sky-700 sm:mt-8">
              开始阅读
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
              />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
