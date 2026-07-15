import Link from "next/link";
import { ArrowRight, BookOpenCheck, Landmark } from "lucide-react";

const guides = [
  {
    title: "大陆用户开通港卡必读指南",
    href: "/posts/why-hk-bank-account",
    description: "先弄清港卡的用途、限制和开户前要准备什么。",
    icon: Landmark
  },
  {
    title: "大陆用户美股券商 101 指南",
    href: "/posts/us-broker-guide",
    description: "快速理解券商账户、交易成本和新手避坑重点。",
    icon: BookOpenCheck
  }
] as const;

export default function BeginnerGuides() {
  return (
    <section aria-labelledby="beginner-guides-heading" className="mx-auto w-full max-w-5xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-sky-700">新手指南</p>
          <h2
            id="beginner-guides-heading"
            className="mt-2 text-2xl font-semibold tracking-normal text-slate-950"
          >
            新手必读
          </h2>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {guides.map(({ title, href, description, icon: Icon }) => (
          <Link
            className="group flex min-h-0 items-start gap-3 rounded-[8px] border border-slate-200 bg-white/88 p-4 shadow-sm shadow-slate-200/70 transition duration-200 active:scale-[0.99] hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500 sm:min-h-44 sm:gap-5 sm:p-6"
            href={href}
            key={href}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-slate-100 text-slate-700">
              <Icon aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-6 text-slate-950 sm:text-lg sm:leading-7">
                {title}
              </span>
              <span className="mt-2 block text-sm leading-6 text-slate-600">
                {description}
              </span>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                查看指南
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
