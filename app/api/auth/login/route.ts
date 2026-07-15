import { NextResponse } from "next/server";

import { withAnalyticsAdminFlag } from "@/lib/analytics/admin";
import { recordProductEvent } from "@/lib/analytics/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { authenticateAccount } from "@/lib/auth/account-service";
import { clientIpFromRequest, rateLimit } from "@/lib/auth/rate-limit";
import { sessionCookieOptions, signSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limited = rateLimit({
    key: `login:${ip}`,
    limit: 30,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: `登录尝试过多，请 ${limited.retryAfterSec} 秒后再试` },
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

  if (!email || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const accountLimited = rateLimit({
    key: `login-account:${ip}:${normalizedEmail}`,
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!accountLimited.ok) {
    return NextResponse.json(
      { error: `该账号登录尝试过多，请 ${accountLimited.retryAfterSec} 秒后再试` },
      {
        status: 429,
        headers: { "Retry-After": String(accountLimited.retryAfterSec) },
      },
    );
  }

  const result = await authenticateAccount(normalizedEmail, password);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        code: result.code,
        email: result.code === "EMAIL_NOT_VERIFIED" ? email.trim().toLowerCase() : undefined,
      },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ user: withAnalyticsAdminFlag(result.user) });
  await recordProductEvent({
    request,
    actorId: result.user.id,
    eventName: "login_completed",
    properties: { status: "success" },
  });
  response.cookies.set(
    SESSION_COOKIE,
    signSessionToken(result.user.id),
    sessionCookieOptions(),
  );
  return response;
}
