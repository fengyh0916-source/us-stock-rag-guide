/**
 * 进程内滑动窗口限流（注册/登录防刷）。
 * 多实例部署时请换 Redis；单机公测足够。
 */

type Bucket = number[];

const buckets = new Map<string, Bucket>();

function prune(times: number[], windowMs: number, now: number): number[] {
  return times.filter((t) => now - t < windowMs);
}

export function rateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: true; remaining: number } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const prev = prune(buckets.get(input.key) || [], input.windowMs, now);
  if (prev.length >= input.limit) {
    const oldest = prev[0]!;
    const retryAfterSec = Math.max(1, Math.ceil((input.windowMs - (now - oldest)) / 1000));
    buckets.set(input.key, prev);
    return { ok: false, retryAfterSec };
  }
  prev.push(now);
  buckets.set(input.key, prev);
  return { ok: true, remaining: input.limit - prev.length };
}

export function clientIpFromRequest(request: Request): string {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  if (vercelForwarded) {
    return vercelForwarded.split(",")[0]!.trim() || "unknown";
  }
  const cloudflare = request.headers.get("cf-connecting-ip");
  if (cloudflare) {
    return cloudflare.trim() || "unknown";
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}
