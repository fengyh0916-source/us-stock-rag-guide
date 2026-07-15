import Link from "next/link";

export default function PrivacyPage() {
  const contactEmail = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || "").trim();

  return (
    <main className="bg-dot-grid min-h-[calc(100vh-3.5rem)] px-5 py-12 text-slate-950 sm:px-6">
      <article className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white/95 p-8 shadow-sm">
        <p className="text-sm font-semibold text-sky-700">法律信息</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">隐私政策</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          更新日期：2026-07-15。本站为美股 / 港卡科普导航与工具站点。以下说明我们如何处理你的信息。
        </p>

        <section className="mt-8 space-y-4 text-sm leading-7 text-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-950">1. 我们收集什么</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>账号：邮箱、昵称、密码哈希（不可逆），用于注册和登录。</li>
              <li>助手请求：你提交的问题和最近最多 8 条对话，用于生成本次回答；本站当前默认不建立长期对话档案。</li>
              <li>资产看板：你主动录入的组合、持仓与相关操作记录，按账号隔离存储。</li>
              <li>安全信息：IP 或其哈希、请求时间、额度和错误信息，用于防滥用与排障。</li>
              <li>匿名统计：页面访问、来源、设备类型，以及助手打开、提问是否成功、耗时、内容点击和匿名反馈，用于改善产品。</li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">2. 我们如何使用</h2>
            <p className="mt-2">
              仅用于提供登录、AI 助手、资产管理等功能，以及安全与配额控制。不会将你的持仓数据出售给第三方，也不会将其作为个性化荐股依据。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">3. 访问统计与产品分析</h2>
            <p className="mt-2">
              本站使用 Vercel Web Analytics 和 Speed Insights 统计匿名页面访问与真实用户性能，并在 Supabase 保存结构化产品事件。产品事件仅保存经哈希处理的匿名标识、事件类型、耗时与数量，不保存问题原文、邮箱、原始 IP 或持仓。游客匿名标识按天变化，不能用于跨站跟踪。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">4. AI 服务与第三方处理</h2>
            <p className="mt-2">
              为生成回答，问题、最近对话和检索到的站内知识片段会发送给 DeepSeek 模型服务。请勿输入身份证件、银行卡号、税号、券商密码、验证码或精确持仓等敏感信息。第三方服务对数据的处理还受其自身政策约束。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">5. 存储与安全</h2>
            <p className="mt-2">
              密码以哈希形式存储；会话使用 HttpOnly Cookie。资产数据按用户 ID
              隔离。请勿在公网演示环境填写你不愿公开的真实大额持仓。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">6. 你的权利</h2>
            <p className="mt-2">
              你可随时退出登录，并可申请查询、更正或删除账号及相关数据。联系邮箱：{" "}
              {contactEmail ? (
                <a className="font-semibold text-sky-700 hover:text-sky-800" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              ) : (
                <span className="font-semibold text-amber-700">公开上线前由运营方补充</span>
              )}
              。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">7. 免责</h2>
            <p className="mt-2">
              本站内容与助手回答仅供科普参考，不构成投资、税务或法律建议。政策与产品规则可能变化，请以官方信息为准。
            </p>
          </div>
        </section>

        <Link href="/" className="mt-8 inline-flex text-sm font-semibold text-sky-700 hover:text-sky-800">
          ← 返回首页
        </Link>
      </article>
    </main>
  );
}
