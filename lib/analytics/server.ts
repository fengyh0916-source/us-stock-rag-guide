import { createHmac } from "node:crypto";

import { clientIpFromRequest } from "@/lib/auth/rate-limit";
import { getSupabaseAuthClient } from "@/lib/auth/supabase-auth";
import type { PublicUser } from "@/lib/auth/types";
import type {
  AnalyticsDashboard,
  AnalyticsDailyPoint,
  AnalyticsSummary,
  ProductEventName,
  ProductEventProperties,
} from "@/lib/analytics/types";

const EMPTY_SUMMARY: AnalyticsSummary = {
  total_events: 0,
  active_actors: 0,
  agent_opens: 0,
  questions: 0,
  answer_successes: 0,
  answer_failures: 0,
  related_clicks: 0,
  signups: 0,
  checkins: 0,
  feedback_total: 0,
  helpful_feedback: 0,
  avg_latency_ms: null,
  p95_latency_ms: null,
};

export function analyticsStorageConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim() &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  );
}

function analyticsSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "dev-only-analytics-secret-change-me"
  );
}

function anonymousActorKey(request: Request): string {
  const day = new Date().toISOString().slice(0, 10);
  const raw = [
    "guest",
    day,
    clientIpFromRequest(request),
    (request.headers.get("user-agent") || "unknown").slice(0, 200),
  ].join(":");
  return createHmac("sha256", analyticsSecret()).update(raw).digest("hex");
}

function userActorKey(userId: string): string {
  return createHmac("sha256", analyticsSecret())
    .update(`user:${userId}`)
    .digest("hex");
}

function cleanText(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanCount(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(max, Math.round(value)));
}

function cleanProperties(properties: ProductEventProperties) {
  return {
    page_type: cleanText(properties.page_type, 20),
    page_slug: cleanText(properties.page_slug, 160),
    source: cleanText(properties.source, 40),
    intent: cleanText(properties.intent, 60),
    provider: cleanText(properties.provider, 40),
    status: cleanText(properties.status, 40),
    error_code: cleanText(properties.error_code, 80),
    latency_ms: cleanCount(properties.latency_ms, 300_000),
    retrieval_count: cleanCount(properties.retrieval_count, 100),
    related_count: cleanCount(properties.related_count, 100),
    helpful: typeof properties.helpful === "boolean" ? properties.helpful : null,
  };
}

export async function recordProductEvent(input: {
  request: Request;
  eventName: ProductEventName;
  properties?: ProductEventProperties;
  user?: PublicUser | null;
  actorId?: string;
}): Promise<boolean> {
  if (!analyticsStorageConfigured()) {
    return false;
  }

  const actorId = input.actorId || input.user?.id;
  const actorType = actorId ? "user" : "guest";
  const actorKey = actorId ? userActorKey(actorId) : anonymousActorKey(input.request);

  try {
    const { error } = await getSupabaseAuthClient()
      .from("product_events")
      .insert({
        event_name: input.eventName,
        actor_type: actorType,
        actor_key: actorKey,
        ...cleanProperties(input.properties || {}),
      });
    if (error) {
      console.error("[analytics] event insert failed", {
        eventName: input.eventName,
        code: error.code,
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error("[analytics] event insert failed", {
      eventName: input.eventName,
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeSummary(value: unknown): AnalyticsSummary {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    total_events: asNumber(source.total_events),
    active_actors: asNumber(source.active_actors),
    agent_opens: asNumber(source.agent_opens),
    questions: asNumber(source.questions),
    answer_successes: asNumber(source.answer_successes),
    answer_failures: asNumber(source.answer_failures),
    related_clicks: asNumber(source.related_clicks),
    signups: asNumber(source.signups),
    checkins: asNumber(source.checkins),
    feedback_total: asNumber(source.feedback_total),
    helpful_feedback: asNumber(source.helpful_feedback),
    avg_latency_ms: source.avg_latency_ms == null ? null : asNumber(source.avg_latency_ms),
    p95_latency_ms: source.p95_latency_ms == null ? null : asNumber(source.p95_latency_ms),
  };
}

function normalizeDaily(value: unknown): AnalyticsDailyPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    if (typeof source.day !== "string") return [];
    return [{
      day: source.day,
      active_actors: asNumber(source.active_actors),
      questions: asNumber(source.questions),
      successes: asNumber(source.successes),
      failures: asNumber(source.failures),
    }];
  });
}

export async function getAnalyticsDashboard(days: number): Promise<{
  configured: boolean;
  data: AnalyticsDashboard;
  error?: string;
}> {
  if (!analyticsStorageConfigured()) {
    return {
      configured: false,
      data: { summary: EMPTY_SUMMARY, daily: [], event_counts: [] },
    };
  }

  const safeDays = Math.max(1, Math.min(90, Math.round(days)));
  const { data, error } = await getSupabaseAuthClient().rpc("analytics_dashboard", {
    p_days: safeDays,
  });

  if (error) {
    return {
      configured: true,
      data: { summary: EMPTY_SUMMARY, daily: [], event_counts: [] },
      error: error.message,
    };
  }

  const source = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const eventCounts = Array.isArray(source.event_counts)
    ? source.event_counts.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return typeof row.event_name === "string"
          ? [{ event_name: row.event_name, count: asNumber(row.count) }]
          : [];
      })
    : [];

  return {
    configured: true,
    data: {
      summary: normalizeSummary(source.summary),
      daily: normalizeDaily(source.daily),
      event_counts: eventCounts,
    },
  };
}
