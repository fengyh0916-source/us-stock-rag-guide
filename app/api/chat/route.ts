import {
  openPythonAgentStream,
  transformAgentSseStream,
} from "@/lib/rag/agent-client";
import {
  consumeGuestChat,
  consumeUserChat,
  guestKeyFromIp,
  refundGuestChat,
  refundUserChat,
} from "@/lib/auth/quota";
import { recordProductEvent } from "@/lib/analytics/server";
import { clientIpFromRequest } from "@/lib/auth/rate-limit";
import { getUserFromRequest } from "@/lib/auth/session";
import type {
  ChatHistoryMessage,
  ChatRequest,
  ChatResponse,
  ClarificationState,
} from "@/lib/rag/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 48 * 1024;
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_CHARS = 4000;
const MAX_HISTORY_TOTAL_CHARS = 12_000;

function isValidPageContext(value: unknown): value is ChatRequest["pageContext"] {
  if (!value || typeof value !== "object") {
    return value === undefined;
  }

  const context = value as { type?: unknown; slug?: unknown };

  return (
    (context.type === "home" || context.type === "series" || context.type === "post") &&
    (context.slug === undefined ||
      (typeof context.slug === "string" && context.slug.length <= 200))
  );
}

function isHistory(value: unknown): value is ChatHistoryMessage[] {
  if (value === undefined) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  if (value.length > MAX_HISTORY_MESSAGES) {
    return false;
  }

  let totalChars = 0;

  return value.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const message = item as { role?: unknown; content?: unknown };
    const valid = (
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.length <= MAX_HISTORY_MESSAGE_CHARS
    );
    if (valid) {
      totalChars += (message.content as string).length;
    }
    return valid && totalChars <= MAX_HISTORY_TOTAL_CHARS;
  });
}

function isClarificationState(value: unknown): value is ClarificationState | null | undefined {
  if (value === undefined || value === null) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const state = value as Partial<ClarificationState>;
  if (
    typeof state.original_question !== "string" ||
    typeof state.topic !== "string" ||
    !Number.isInteger(state.asked_count) ||
    (state.asked_count ?? -1) < 0 ||
    (state.asked_count ?? 3) > 2 ||
    typeof state.pending_slot !== "string" ||
    !state.collected ||
    typeof state.collected !== "object" ||
    Array.isArray(state.collected)
  ) {
    return false;
  }
  return Object.values(state.collected).every((item) => typeof item === "string");
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as {
    message?: unknown;
    pageContext?: unknown;
    history?: unknown;
    clarificationState?: unknown;
  };

  return (
    typeof request.message === "string" &&
    isValidPageContext(request.pageContext) &&
    isHistory(request.history) &&
    isClarificationState(request.clarificationState)
  );
}

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "请求内容过大" }, { status: 413 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isChatRequest(body) || body.message.trim().length === 0) {
    return Response.json({ error: "A non-empty message is required." }, { status: 400 });
  }

  if (body.message.trim().length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { error: "Message is too long (max 2000 characters)." },
      { status: 400 },
    );
  }

  const user = await getUserFromRequest(request);
  let refundQuota: () => Promise<void>;

  if (user) {
    const quota = await consumeUserChat(user.id);
    if (!quota.ok) {
      if (quota.code === "NEED_CHECKIN") {
        return Response.json(
          {
            error: "今日尚未签到，签到后可获得 10 次问答额度",
            code: "NEED_CHECKIN",
            used: quota.used,
            allowance: quota.allowance,
          },
          { status: 429 },
        );
      }
      return Response.json(
        {
          error: `今日问答次数已用完（${quota.used}/${quota.allowance}），请明天签到再来`,
          code: "QUOTA_EXCEEDED",
          used: quota.used,
          allowance: quota.allowance,
        },
        { status: 429 },
      );
    }
    refundQuota = () => refundUserChat(user.id);
  } else {
    const ip = clientIpFromRequest(request);
    const guestKey = guestKeyFromIp(ip);
    const guest = await consumeGuestChat(guestKey);
    if (!guest.ok) {
      return Response.json(
        {
          error: `游客免费额度已用完（${guest.used}/${guest.limit} 次），登录并签到后每天可获得更多次数`,
          code: "GUEST_LIMIT",
          used: guest.used,
          limit: guest.limit,
        },
        { status: 401 },
      );
    }
    refundQuota = () => refundGuestChat(guestKey);
  }

  const message = body.message.trim();
  const history = (body.history ?? []).slice(-8);
  await recordProductEvent({
    request,
    user,
    eventName: "question_submitted",
    properties: {
      page_type: body.pageContext?.type,
      page_slug: body.pageContext?.slug,
      status: "accepted",
    },
  });
  const upstream = await openPythonAgentStream(
    message,
    history,
    body.clarificationState ?? null,
    request.signal,
  );

  if (upstream?.body) {
    return sseResponse(
      transformAgentSseStream(upstream.body, message, {
        onFinalIntent: async (intent) => {
          if (intent === "clarify") {
            await refundQuota();
          }
        },
        onFinal: async (result) => {
          await recordProductEvent({
            request,
            user,
            eventName: "answer_succeeded",
            properties: {
              page_type: body.pageContext?.type,
              page_slug: body.pageContext?.slug,
              intent: result.intent,
              provider: result.provider,
              status: result.intent === "clarify" ? "clarification" : "completed",
              latency_ms: Date.now() - startedAt,
              retrieval_count: result.contextsUsed,
              related_count: result.relatedCount,
            },
          });
        },
        onFailure: async () => {
          await refundQuota();
          await recordProductEvent({
            request,
            user,
            eventName: "answer_failed",
            properties: {
              page_type: body.pageContext?.type,
              page_slug: body.pageContext?.slug,
              error_code: "STREAM_FAILED",
              latency_ms: Date.now() - startedAt,
            },
          });
        },
      }),
    );
  }

  await refundQuota();
  await recordProductEvent({
    request,
    user,
    eventName: "answer_failed",
    properties: {
      page_type: body.pageContext?.type,
      page_slug: body.pageContext?.slug,
      error_code: "AGENT_UNAVAILABLE",
      latency_ms: Date.now() - startedAt,
    },
  });
  return Response.json(
    {
      error: "AI 助手暂时不可用，本次未扣除问答额度，请稍后重试。",
      code: "AGENT_UNAVAILABLE",
    },
    { status: 503 },
  );
}
