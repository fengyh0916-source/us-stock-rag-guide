import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionTokenEdge } from "@/lib/auth/session-edge";

/**
 * Static asset-tracker UI gate. The FastAPI backend independently verifies the
 * signed session for every user-data endpoint, so this is not the sole auth layer.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySessionTokenEdge(token))) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/tools/asset-tracker";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/asset-tracker", "/asset-tracker/:path*"],
};
