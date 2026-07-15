import { NextResponse } from "next/server";

import { getUserFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({ user });
}
