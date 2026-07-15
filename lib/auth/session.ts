import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth/constants";
import { findAccountById } from "@/lib/auth/account-service";
import { withAnalyticsAdminFlag } from "@/lib/analytics/admin";
import type { PublicUser } from "@/lib/auth/types";

type TokenPayload = {
  sub: string;
  exp: number;
};

function getSecret(): string {
  const secret = (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "").trim();
  if (secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须配置至少 32 字符的 AUTH_SECRET");
  }

  return "dev-only-auth-secret-change-me";
}

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function signSessionToken(userId: string): string {
  const payload: TokenPayload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", getSecret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [body, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(body).digest();
  let actual: Buffer;
  try {
    actual = fromB64url(sig);
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(fromB64url(body).toString("utf-8")) as TokenPayload;
    if (!payload.sub || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    return null;
  }
  const user = await findAccountById(payload.sub);
  return user ? withAnalyticsAdminFlag(user) : null;
}

/** For Route Handlers that receive a Request (cookie header). */
export async function getUserFromRequest(request: Request): Promise<PublicUser | null> {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const token = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!token) {
    return null;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    return null;
  }
  const user = await findAccountById(payload.sub);
  return user ? withAnalyticsAdminFlag(user) : null;
}
