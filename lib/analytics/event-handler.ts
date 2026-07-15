import { NextResponse } from "next/server";

import { recordProductEvent } from "@/lib/analytics/server";
import {
  CLIENT_EVENT_NAMES,
  type ClientEventName,
  type ProductEventProperties,
} from "@/lib/analytics/types";
import { clientIpFromRequest, rateLimit } from "@/lib/auth/rate-limit";
import { getUserFromRequest } from "@/lib/auth/session";

const MAX_BODY_BYTES = 4 * 1024;
const CLIENT_EVENTS = new Set<string>(CLIENT_EVENT_NAMES);

function parseProperties(value: unknown): ProductEventProperties {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  return {
    page_type:
      source.page_type === "home" ||
      source.page_type === "series" ||
      source.page_type === "post" ||
      source.page_type === "tool" ||
      source.page_type === "other"
        ? source.page_type
        : undefined,
    page_slug: typeof source.page_slug === "string" ? source.page_slug : undefined,
    source: typeof source.source === "string" ? source.source : undefined,
    intent: typeof source.intent === "string" ? source.intent : undefined,
    provider: typeof source.provider === "string" ? source.provider : undefined,
    helpful: typeof source.helpful === "boolean" ? source.helpful : undefined,
  };
}

export async function handleProductEvent(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  }

  const ip = clientIpFromRequest(request);
  const limited = rateLimit({
    key: `analytics:${ip}`,
    limit: 120,
    windowMs: 60 * 1000,
  });
  if (!limited.ok) {
    return new NextResponse(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof source.eventName !== "string" || !CLIENT_EVENTS.has(source.eventName)) {
    return NextResponse.json({ error: "不支持的事件" }, { status: 400 });
  }

  const user = await getUserFromRequest(request);
  await recordProductEvent({
    request,
    user,
    eventName: source.eventName as ClientEventName,
    properties: parseProperties(source.properties),
  });

  return new NextResponse(null, { status: 204 });
}
