"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { LoaderCircle, X } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { LOGIN_REASON_COPY } from "@/lib/auth/constants";

/** 邮箱验证支持本地验证码与 Supabase 默认确认链接。 */
type Mode = "login" | "register" | "verify";
type VerificationMode = "code" | "link";

// text-base(16px) 避免 iOS 聚焦输入框时整页放大
const fieldClass =
  "w-full rounded-full border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200";

const primaryBtnClass =
  "flex w-full items-center justify-center gap-2 rounded-full bg-[#0d0d0d] px-4 py-3.5 text-base font-medium text-white transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 active:scale-[0.99]";

export default function LoginModal() {
  const {
    loginOpen,
    loginReason,
    closeLogin,
    login,
    register,
    verifyEmail,
    resendCode,
  } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [verificationMode, setVerificationMode] = useState<VerificationMode>("code");
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const copy = LOGIN_REASON_COPY[loginReason] ?? LOGIN_REASON_COPY.general;

  useEffect(() => {
    if (!loginOpen) {
      return;
    }
    setError(null);
    setInfo(null);
    setDevCode(null);
    setVerificationMode("code");
    setCode("");
    setPassword("");
    setDisplayName("");
    setMode("login");
  }, [loginOpen, loginReason]);

  useEffect(() => {
    if (!loginOpen) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeLogin();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loginOpen, closeLogin]);

  if (!loginOpen) {
    return null;
  }

  async function goVerify(
    targetEmail: string,
    maybeDevCode?: string,
    nextVerificationMode: VerificationMode = "code",
  ) {
    setEmail(targetEmail);
    setMode("verify");
    setVerificationMode(nextVerificationMode);
    setInfo(
      nextVerificationMode === "link"
        ? "请点击邮件中的确认链接，完成后返回此处"
        : "请输入发到邮箱的 6 位验证码",
    );
    if (maybeDevCode) {
      setDevCode(maybeDevCode);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const result = await login(email.trim(), password);
        if (result.ok) {
          return;
        }
        if (result.needsVerification) {
          const resent = await resendCode(result.email || email.trim());
          await goVerify(
            result.email || email.trim(),
            resent.ok ? resent.devCode : undefined,
            resent.ok ? resent.verificationMode : "code",
          );
          return;
        }
        setError(result.error);
        if (result.error.includes("不正确")) {
          setInfo("还没有账号？切换到「注册」即可");
        }
        return;
      }

      if (mode === "register") {
        const result = await register(
          email.trim(),
          password,
          displayName.trim() || undefined,
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // 当前默认：邮箱+密码注册成功即登录
        if (!result.needsVerification) {
          return;
        }
        await goVerify(
          result.email,
          result.devCode,
          result.verificationMode || "code",
        );
        return;
      }

      // verify（仅当服务端开启邮箱验证时才会进入）
      if (verificationMode === "link") {
        const result = await login(email.trim(), password);
        if (!result.ok) {
          setError(
            result.needsVerification
              ? "尚未检测到邮箱确认，请先点击邮件中的链接"
              : result.error,
          );
        }
        return;
      }
      const result = await verifyEmail(email.trim(), code.trim());
      if (!result.ok) {
        setError(result.error);
      }
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError(null);
    setBusy(true);
    try {
      const result = await resendCode(email.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setInfo(result.message || "验证码已重新发送");
      if (result.verificationMode) {
        setVerificationMode(result.verificationMode);
      }
      if (result.devCode) {
        setDevCode(result.devCode);
      }
    } catch {
      setError("发送失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "verify"
      ? verificationMode === "link"
        ? "确认邮箱"
        : "验证邮箱"
      : mode === "register"
        ? "注册"
        : "登录或注册";

  const sub =
    mode === "verify"
      ? verificationMode === "link"
        ? `确认邮件已发送至 ${email}`
        : `验证码将发送至 ${email}`
      : mode === "register"
        ? "使用邮箱和密码创建账号，即可使用助手与资产看板"
        : copy.description;

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#f4f4f4]/80 backdrop-blur-[2px]"
        aria-label="关闭"
        onClick={closeLogin}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[min(92dvh,720px)] w-full max-w-[400px] overflow-y-auto overscroll-contain rounded-t-2xl border border-black/5 bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-[0_8px_40px_rgba(0,0,0,0.12)] sm:rounded-2xl sm:px-7 sm:pb-7 sm:pt-6"
      >
        <button
          type="button"
          onClick={closeLogin}
          className="absolute right-3.5 top-3.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          aria-label="关闭"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        <div className="mx-auto max-w-[320px] pt-2 text-center">
          <h2
            id={titleId}
            className="text-[22px] font-semibold tracking-tight text-slate-950"
          >
            {heading}
          </h2>
          <p className="mt-2 text-[13.5px] leading-5 text-slate-500">{sub}</p>
        </div>

        <div className="mx-auto mt-6 max-w-[320px]">
          {mode !== "verify" ? (
            <div className="mb-4 flex rounded-full bg-slate-100 p-1 text-sm font-medium">
              <button
                type="button"
                className={`flex-1 rounded-full py-2 transition ${
                  mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                }`}
                onClick={() => {
                  setMode("login");
                  setError(null);
                  setInfo(null);
                }}
              >
                登录
              </button>
              <button
                type="button"
                className={`flex-1 rounded-full py-2 transition ${
                  mode === "register" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                }`}
                onClick={() => {
                  setMode("register");
                  setError(null);
                  setInfo(null);
                }}
              >
                注册
              </button>
            </div>
          ) : null}

          <form className="space-y-3" onSubmit={handleSubmit}>
            {mode === "register" ? (
              <div>
                <label className="sr-only" htmlFor="auth-name">
                  昵称
                </label>
                <input
                  id="auth-name"
                  className={fieldClass}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="昵称（可选）"
                  autoComplete="nickname"
                  maxLength={32}
                />
              </div>
            ) : null}

            {mode !== "verify" ? (
              <>
                <div>
                  <label className="sr-only" htmlFor="auth-email">
                    邮箱
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoFocus={mode === "login"}
                    className={fieldClass}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="邮箱"
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="sr-only" htmlFor="auth-password">
                    密码
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={mode === "register" ? 10 : 1}
                    autoFocus={mode === "register"}
                    className={fieldClass}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "register" ? "密码（至少 10 位）" : "密码"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />
                </div>
              </>
            ) : verificationMode === "code" ? (
              <div>
                <label className="sr-only" htmlFor="auth-code">
                  验证码
                </label>
                <input
                  id="auth-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  className={`${fieldClass} text-center text-lg font-semibold tracking-[0.35em] placeholder:tracking-normal`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6 位验证码"
                  autoComplete="one-time-code"
                />
              </div>
            ) : (
              <div className="rounded-2xl bg-sky-50 px-4 py-4 text-center text-sm leading-6 text-sky-950">
                请在新页面打开邮件中的确认链接，然后返回此处继续。
              </div>
            )}

            {info ? (
              <p className="text-center text-xs leading-5 text-slate-600">{info}</p>
            ) : null}
            {devCode ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">
                开发模式验证码：
                <span className="ml-1 font-mono font-bold tracking-widest">{devCode}</span>
              </p>
            ) : null}
            {error ? (
              <p className="text-center text-xs leading-5 text-red-600">{error}</p>
            ) : null}

            <button type="submit" disabled={busy} className={primaryBtnClass}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {mode === "login"
                ? "登录"
                : mode === "register"
                  ? "注册"
                  : verificationMode === "link"
                    ? "我已完成邮箱确认"
                    : "验证并登录"}
            </button>

            {mode === "verify" ? (
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResend()}
                  className="font-medium text-slate-800 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  重新发送
                </button>
                <button
                  type="button"
                  className="font-medium text-slate-500 hover:text-slate-800"
                  onClick={() => {
                  setMode("login");
                  setCode("");
                  setError(null);
                  setInfo(null);
                  setDevCode(null);
                  setVerificationMode("code");
                }}
                >
                  返回登录
                </button>
              </div>
            ) : null}
          </form>

          <p className="mt-5 text-center text-[11px] leading-4 text-slate-400">
            当前支持邮箱与密码
            {mode === "register" ? "注册" : "登录"}
            。继续即表示同意
            <a className="mx-0.5 text-slate-600 underline-offset-2 hover:underline" href="/terms">
              用户协议
            </a>
            与
            <a className="mx-0.5 text-slate-600 underline-offset-2 hover:underline" href="/privacy">
              隐私政策
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
