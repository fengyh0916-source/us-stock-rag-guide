import { NextResponse } from "next/server";

import {
  getGuestQuotaStatus,
  getUserQuotaStatus,
  guestKeyFromIp,
} from "@/lib/auth/quota";
import { clientIpFromRequest } from "@/lib/auth/rate-limit";
import { getUserFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (user) {
    const status = await getUserQuotaStatus(user.id);
    return NextResponse.json({ ...status, userId: user.id });
  }

  const ip = clientIpFromRequest(request);
  const status = await getGuestQuotaStatus(guestKeyFromIp(ip));
  return NextResponse.json(status);
}
