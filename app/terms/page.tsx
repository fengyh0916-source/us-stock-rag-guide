import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="bg-dot-grid min-h-[calc(100vh-3.5rem)] px-5 py-12 text-slate-950 sm:px-6">
      <article className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white/95 p-8 shadow-sm">
        <p className="text-sm font-semibold text-sky-700">法律信息</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">用户协议</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          更新日期：2026-07-14。使用本站服务即表示你理解并同意以下条款。
        </p>

        <section className="mt-8 space-y-4 text-sm leading-7 text-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-950">1. 服务内容</h2>
            <p className="mt-2">
              本站提供美股 / 港卡 / 出入金相关的图文科普、AI 问答助手，以及个人资产管理看板。教程可匿名阅读；助手可匿名限次体验，资产看板及更多问答额度需注册登录。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">2. 非投资建议</h2>
            <p className="mt-2">
              所有内容仅供科普与学习参考，不构成任何投资、税务或法律建议。你应独立判断风险，必要时咨询持牌专业人士。禁止将助手用于寻求具体荐股、逃税或造假材料等用途。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">3. 账号责任</h2>
            <p className="mt-2">
              请妥善保管账号与密码。不得恶意注册、滥用接口或干扰服务。我们有权对违规账号限制功能或封禁。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">4. 资产数据</h2>
            <p className="mt-2">
              资产看板中的数据由你自行录入或同步，按账号隔离。服务按「尽力而为」提供，不对数据完整性、行情实时性或盈亏计算做任何保证。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">5. 推荐链接与利益披露</h2>
            <p className="mt-2">
              部分教程可能包含邀请码、推荐链接或活动信息。你通过这些链接注册或使用服务时，本站运营者可能获得平台奖励；这不会增加你的必然收益，也不代表对相关平台作出安全或收益保证。请以平台最新官方规则为准。
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">6. 服务变更</h2>
            <p className="mt-2">
              我们可能调整功能、配额或下线部分服务。重大变更将尽量通过站点公告说明。
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
