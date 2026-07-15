import { NextResponse } from "next/server";

import { sendVerificationEmail } from "@/lib/auth/email";
import { resendSupabaseAccountCode, usesSupabaseAuth } from "@/lib/auth/account-service";
import { clientIpFromRequest, rateLimit } from "@/lib/auth/rate-limit";
import {
  findUserByEmail,
  issueEmailCode,
} from "@/lib/auth/users-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limited = rateLimit({
    key: `resend:${ip}`,
    limit: 8,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: `发送过于频繁，请 ${limited.retryAfterSec} 秒后再试` },
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
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";

  if (!email) {
    return NextResponse.json({ error: "请输入邮箱" }, { status: 400 });
  }

  if (usesSupabaseAuth()) {
    const result = await resendSupabaseAccountCode(email);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      message: "如果该邮箱已注册且未验证，我们已重新发送确认链接",
      delivery: "supabase",
      verificationMode: "link",
    });
  }

  const user = await findUserByEmail(email);
  // 不暴露是否注册，统一文案
  if (!user) {
    return NextResponse.json({
      ok: true,
      message: "如果该邮箱已注册且未验证，我们已发送验证码",
    });
  }
  if (user.emailVerified) {
    return NextResponse.json({
      ok: true,
      message: "该邮箱已完成验证，请直接登录",
      alreadyVerified: true,
    });
  }

  // 同一邮箱额外限流
  const emailLimit = rateLimit({
    key: `resend-email:${email}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!emailLimit.ok) {
    return NextResponse.json(
      { error: `该邮箱发送次数过多，请 ${emailLimit.retryAfterSec} 秒后再试` },
      { status: 429 },
    );
  }

  const code = await issueEmailCode(user.id, user.email);
  const sent = await sendVerificationEmail({ to: user.email, code });
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  const payload: Record<string, unknown> = {
    ok: true,
    message: "验证码已重新发送",
    delivery: sent.mode,
  };
  if (process.env.NODE_ENV !== "production" && sent.mode === "console") {
    payload.devCode = code;
  }
  return NextResponse.json(payload);
}
