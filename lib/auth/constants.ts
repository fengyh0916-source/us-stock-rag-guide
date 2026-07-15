/** HttpOnly session cookie name */
export const SESSION_COOKIE = "msg_session";

/** Session lifetime: 30 days */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export const LOGIN_REASON_COPY: Record<
  "agent" | "asset-tracker" | "general",
  { title: string; description: string }
> = {
  agent: {
    title: "登录后继续提问",
    description: "游客可免费体验 3 次。登录并每日签到，可获得 10 次问答额度。",
  },
  "asset-tracker": {
    title: "登录后使用资产管理看板",
    description: "资产数据属于个人隐私，登录后才能进入看板，避免他人看到你的持仓。",
  },
  general: {
    title: "登录或注册",
    description: "使用邮箱和密码即可。登录后可使用 AI 助手与资产管理看板；浏览教程无需登录。",
  },
};
