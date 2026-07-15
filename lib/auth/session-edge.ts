/**
 * Edge-compatible session token verify (for middleware).
 * Token format matches lib/auth/session.ts: base64url(payload).base64url(hmac-sha256)
 */

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

function fromB64url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export async function verifySessionTokenEdge(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [body, sigB64] = parts;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(getSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const expected = new Uint8Array(sig);
    const actual = fromB64url(sigB64);
    if (!timingSafeEqual(expected, actual)) {
      return false;
    }
    const json = new TextDecoder().decode(fromB64url(body));
    const payload = JSON.parse(json) as { sub?: string; exp?: number };
    if (!payload.sub || typeof payload.exp !== "number") {
      return false;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
