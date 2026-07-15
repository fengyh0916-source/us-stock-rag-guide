import { NextResponse } from "next/server";

import { withAnalyticsAdminFlag } from "@/lib/analytics/admin";
import { recordProductEvent } from "@/lib/analytics/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifyAccountEmail } from "@/lib/auth/account-service";
import { clientIpFromRequest, rateLimit } from "@/lib/auth/rate-limit";
import { sessionCookieOptions, signSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limited = rateLimit({
    key: `verify:${ip}`,
    limit: 40,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: `操作过于频繁，请 ${limited.retryAfterSec} 秒后再试` },
      { status: 429 },
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
  const code =
    typeof (body as { code?: unknown }).code === "string"
      ? (body as { code: string }).code
      : "";

  if (!email || !code) {
    return NextResponse.json({ error: "请输入邮箱和验证码" }, { status: 400 });
  }

  const result = await verifyAccountEmail(email, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const response = NextResponse.json({ user: withAnalyticsAdminFlag(result.user) });
  await recordProductEvent({
    request,
    actorId: result.user.id,
    eventName: "signup_completed",
    properties: { status: "verified" },
  });
  response.cookies.set(
    SESSION_COOKIE,
    signSessionToken(result.user.id),
    sessionCookieOptions(),
  );
  return response;
}
