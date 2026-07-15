import { NextResponse } from "next/server";

import { withAnalyticsAdminFlag } from "@/lib/analytics/admin";
import { recordProductEvent } from "@/lib/analytics/server";
import { isEmailVerificationRequired } from "@/lib/auth/config";
import { registerAccount, usesSupabaseAuth } from "@/lib/auth/account-service";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { emailConfigured, sendVerificationEmail } from "@/lib/auth/email";
import { clientIpFromRequest, rateLimit } from "@/lib/auth/rate-limit";
import { sessionCookieOptions, signSessionToken } from "@/lib/auth/session";
import { issueEmailCode } from "@/lib/auth/users-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limited = rateLimit({
    key: `register:${ip}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: `注册过于频繁，请 ${limited.retryAfterSec} 秒后再试` },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const email =
    typeof (body as { email?: unknown }).email === "string"
      ? (body as { email: string }).email
      : "";
  const password =
    typeof (body as { password?: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";
  const displayName =
    typeof (body as { displayName?: unknown }).displayName === "string"
      ? (body as { displayName: string }).displayName
      : undefined;

  const supabaseAuth = usesSupabaseAuth();
  if (!supabaseAuth && isEmailVerificationRequired() && !emailConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "注册服务尚未完成邮件配置，请稍后再试" },
      { status: 503 },
    );
  }

  const result = await registerAccount({ email, password, displayName });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // 开发环境可关闭验证；生产环境默认必须先验证邮箱。
  if (!isEmailVerificationRequired() || !result.needsVerification) {
    await recordProductEvent({
      request,
      actorId: result.user.id,
      eventName: "signup_completed",
      properties: { status: "verified" },
    });
    const response = NextResponse.json({
      user: withAnalyticsAdminFlag(result.user),
      needsVerification: false,
    });
    response.cookies.set(
      SESSION_COOKIE,
      signSessionToken(result.user.id),
      sessionCookieOptions(),
    );
    return response;
  }

  if (supabaseAuth) {
    return NextResponse.json({
      needsVerification: true,
      email: result.user.email,
      message: "确认邮件已发送，请点击邮件中的链接完成验证",
      delivery: "supabase",
      verificationMode: "link",
    });
  }

  // 可选：开启 EMAIL_VERIFICATION_REQUIRED 后走验证码
  const code = await issueEmailCode(result.user.id, result.user.email);
  const sent = await sendVerificationEmail({ to: result.user.email, code });
  if (!sent.ok) {
    return NextResponse.json(
      {
        error: sent.error,
        needsVerification: true,
        email: result.user.email,
      },
      { status: 502 },
    );
  }

  const payload: Record<string, unknown> = {
    needsVerification: true,
    email: result.user.email,
    message: "验证码已发送，请查收邮箱完成验证",
    delivery: sent.mode,
  };

  if (process.env.NODE_ENV !== "production" && sent.mode === "console") {
    payload.devCode = code;
  }

  return NextResponse.json(payload);
}
