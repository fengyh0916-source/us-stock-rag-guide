import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/constants";
import { sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}
