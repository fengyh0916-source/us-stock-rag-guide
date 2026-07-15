import { NextResponse } from "next/server";

import { recordProductEvent } from "@/lib/analytics/server";
import { dailyCheckIn, getUserQuotaStatus } from "@/lib/auth/quota";
import { clientIpFromRequest, rateLimit } from "@/lib/auth/rate-limit";
import { getUserFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { error: "请先登录后再签到", code: "AUTH_REQUIRED" },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const limited = rateLimit({
    key: `checkin:${ip}:${user.id}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "操作过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  const result = await dailyCheckIn(user.id);
  const status = await getUserQuotaStatus(user.id);

  if (result.already) {
    return NextResponse.json({
      ok: true,
      already: true,
      message: "今日已签到",
      ...status,
    });
  }

  await recordProductEvent({
    request,
    user,
    eventName: "checkin_completed",
    properties: { status: "success" },
  });

  return NextResponse.json({
    ok: true,
    already: false,
    message: `签到成功，获得 ${result.reward} 次今日问答额度`,
    ...status,
  });
}
