import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200/80 bg-white/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-8 lg:px-8">
        <p className="max-w-xl text-[13px] leading-6 sm:text-sm">
          本内容仅供科普参考，不构成投资、税务或法律建议。市场有风险，决策需独立判断。
        </p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-[env(safe-area-inset-bottom)] text-sm font-medium text-slate-600">
          <Link className="hover:text-sky-700" href="/terms">
            用户协议
          </Link>
          <Link className="hover:text-sky-700" href="/privacy">
            隐私政策
          </Link>
          <Link className="hover:text-sky-700" href="/">
            首页
          </Link>
        </nav>
      </div>
    </footer>
  );
}
