import type {
  ChatHistoryMessage,
  ChatResponse,
  ChatSource,
  ClarificationState,
} from "@/lib/rag/types";
import { stripMarkdownSymbols } from "@/lib/rag/format-answer";
import { encodeSse } from "@/lib/rag/sse";

export type AgentCitation = {
  chapter?: string;
  section?: string;
  page_start?: number | null;
  page_end?: number | null;
  id?: string;
  url?: string;
  source?: string;
};

export type AgentChatResponse = {
  answer?: string;
  intent?: string;
  citations?: AgentCitation[];
  contexts_used?: number;
  detail?: string;
  clarification_state?: ClarificationState | null;
};

const DEFAULT_AGENT_URL = "http://127.0.0.1:8001";

export function getAgentBaseUrl() {
  return (process.env.AGENT_URL || DEFAULT_AGENT_URL).replace(/\/$/, "");
}

export function mapCitationsToSources(citations: AgentCitation[] | undefined): ChatSource[] {
  if (!citations?.length) {
    return [];
  }

  return citations.map((citation) => {
    const isPost = Boolean(citation.url) || citation.source === "post";
    const chapter = citation.chapter?.trim() || (isPost ? "站内教程" : "中国人投资美股指南");
    const section = citation.section?.trim() || "相关章节";
    const pageLabel =
      !isPost && citation.page_start != null && citation.page_start > 0
        ? citation.page_end != null && citation.page_end !== citation.page_start
          ? `p.${citation.page_start}-${citation.page_end}`
          : `p.${citation.page_start}`
        : "";

    return {
      title: chapter,
      section: pageLabel ? `${section} · ${pageLabel}` : section,
      url: citation.url || undefined,
      pageStart: citation.page_start ?? null,
      pageEnd: citation.page_end ?? null,
    };
  });
}

export function relatedArticlesFromMessage(
  message: string,
  sources: ChatSource[] = [],
): ChatResponse["relatedArticles"] {
  const articles: ChatResponse["relatedArticles"] = [];

  const pushUnique = (title: string, url: string) => {
    if (!url || articles.some((item) => item.url === url)) {
      return;
    }
    articles.push({ title, url });
  };

  // Prefer retrieved post links from RAG
  for (const source of sources) {
    if (source.url?.startsWith("/posts/")) {
      pushUnique(source.title, source.url);
    }
  }

  const text = message.toLowerCase();

  if (/港卡|香港|境外银行|银行账户|众安|ifast|中银/.test(text)) {
    pushUnique("大陆用户开通港卡必读指南", "/posts/why-hk-bank-account");
    pushUnique("众安银行开户教程", "/posts/za-bank-account-opening");
  }

  if (/券商|ibkr|盈透|firstrade|嘉信|schwab|开户|长桥|复星/.test(text)) {
    pushUnique("大陆用户美股券商 101 指南", "/posts/us-broker-guide");
    pushUnique("盈透券商开户攻略", "/posts/ibkr-account");
  }

  if (/入金|出金|汇款|转账|wise|资金|出入金|usdt/.test(text)) {
    pushUnique("Wise 多币种钱包教程", "/posts/wise-account");
    pushUnique("港卡的钱怎么在内地花", "/posts/hk-card-spending-in-mainland");
  }

  return articles.slice(0, 4);
}

export function mapAgentResponse(data: AgentChatResponse, message: string): ChatResponse {
  const answer = stripMarkdownSymbols((data.answer || "").trim());
  const sources = mapCitationsToSources(data.citations);
  const warnings: string[] = [];

  if (data.intent === "refuse") {
    warnings.push("已触发安全边界：不提供荐股或违规操作指导。");
  }

  if (data.contexts_used === 0 && data.intent === "knowledge") {
    warnings.push("本次未命中足够知识片段，回答可能较保守。");
  }

  return {
    answer: answer || "暂时无法生成回答，请稍后重试。",
    warnings,
    sources,
    relatedArticles: relatedArticlesFromMessage(message, sources),
    intent: data.intent,
    contextsUsed: data.contexts_used,
    provider: "agent",
    clarificationState: data.clarification_state ?? null,
  };
}

export async function chatWithPythonAgent(
  message: string,
  history: ChatHistoryMessage[] = [],
  clarificationState: ClarificationState | null = null,
): Promise<ChatResponse | null> {
  const baseUrl = getAgentBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        history: history.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        clarification_state: clarificationState,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      let detail = `Agent HTTP ${response.status}`;
      try {
        const errorBody = (await response.json()) as AgentChatResponse;
        if (errorBody.detail) {
          detail = errorBody.detail;
        }
      } catch {
        // ignore parse errors
      }
      console.error("[agent-client]", detail);
      return null;
    }

    const data = (await response.json()) as AgentChatResponse;
    if (!data.answer) {
      return null;
    }

    return mapAgentResponse(data, message);
  } catch (error) {
    console.error("[agent-client] failed to reach Python agent:", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function openPythonAgentStream(
  message: string,
  history: ChatHistoryMessage[] = [],
  clarificationState: ClarificationState | null = null,
  requestSignal?: AbortSignal,
): Promise<Response | null> {
  const baseUrl = getAgentBaseUrl();
  const timeoutSignal = AbortSignal.timeout(45_000);
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        history: history.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        clarification_state: clarificationState,
      }),
      signal,
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      console.error("[agent-client] stream failed:", response.status);
      return null;
    }

    return response;
  } catch (error) {
    console.error("[agent-client] failed to open stream:", error);
    return null;
  }
}

export function createMockSseStream(response: ChatResponse): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const answer = stripMarkdownSymbols(response.answer);
  const chunkSize = 18;

  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          encodeSse("meta", {
            intent: response.intent ?? "knowledge",
            citations: [],
            sources: response.sources,
            relatedArticles: response.relatedArticles,
            warnings: response.warnings,
            provider: response.provider ?? "mock",
            clarification_state: response.clarificationState ?? null,
          }),
        ),
      );

      for (let index = 0; index < answer.length; index += chunkSize) {
        controller.enqueue(
          encoder.encode(
            encodeSse("token", {
              text: answer.slice(index, index + chunkSize),
            }),
          ),
        );
      }

      controller.enqueue(
        encoder.encode(
          encodeSse("done", {
            answer,
            intent: response.intent ?? "knowledge",
            citations: [],
            sources: response.sources,
            relatedArticles: response.relatedArticles,
            warnings: response.warnings,
            contexts_used: response.contextsUsed ?? 0,
            provider: response.provider ?? "mock",
            clarification_state: response.clarificationState ?? null,
          }),
        ),
      );

      controller.close();
    },
  });
}

/**
 * Transform upstream agent SSE into website-friendly SSE (mapped sources, cleaned answer).
 */
export function transformAgentSseStream(
  upstream: ReadableStream<Uint8Array>,
  message: string,
  callbacks: {
    onFinalIntent?: (intent: string) => Promise<void> | void;
    onFinal?: (result: {
      intent: string;
      contextsUsed: number;
      relatedCount: number;
      sourceCount: number;
      provider: "agent";
    }) => Promise<void> | void;
    onFailure?: () => Promise<void> | void;
  } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let intent = "knowledge";
  let citations: AgentCitation[] = [];
  let clarificationState: ClarificationState | null = null;
  let finalized = false;
  let failed = false;

  async function markFailed() {
    if (finalized || failed) {
      return;
    }
    failed = true;
    try {
      await callbacks.onFailure?.();
    } catch (error) {
      console.error("[agent-client] failure callback failed:", error);
    }
  }

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();

      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSse(event, data)));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary === -1) {
              break;
            }

            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            let eventName = "message";
            const dataLines: string[] = [];

            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart());
              }
            }

            if (dataLines.length === 0) {
              continue;
            }

            let payload: Record<string, unknown> = {};
            try {
              payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (eventName === "meta") {
              intent = typeof payload.intent === "string" ? payload.intent : intent;
              citations = Array.isArray(payload.citations)
                ? (payload.citations as AgentCitation[])
                : [];
              clarificationState =
                payload.clarification_state && typeof payload.clarification_state === "object"
                  ? (payload.clarification_state as ClarificationState)
                  : null;
              emit("meta", {
                intent,
                sources: mapCitationsToSources(citations),
                relatedArticles: relatedArticlesFromMessage(message),
                warnings:
                  intent === "refuse"
                    ? ["已触发安全边界：不提供荐股或违规操作指导。"]
                    : [],
                provider: "agent",
                clarification_state: clarificationState,
              });
              continue;
            }

            if (eventName === "token") {
              const text = typeof payload.text === "string" ? payload.text : "";
              if (text) {
                fullText += text;
                emit("token", { text });
              }
              continue;
            }

            if (eventName === "done") {
              const mapped = mapAgentResponse(
                {
                  answer:
                    typeof payload.answer === "string" ? payload.answer : fullText,
                  intent: typeof payload.intent === "string" ? payload.intent : intent,
                  citations: Array.isArray(payload.citations)
                    ? (payload.citations as AgentCitation[])
                    : citations,
                  contexts_used:
                    typeof payload.contexts_used === "number"
                      ? payload.contexts_used
                      : undefined,
                  clarification_state:
                    payload.clarification_state &&
                    typeof payload.clarification_state === "object"
                      ? (payload.clarification_state as ClarificationState)
                      : null,
                },
                message,
              );
              if (!finalized) {
                finalized = true;
                try {
                  await callbacks.onFinalIntent?.(mapped.intent ?? intent);
                  await callbacks.onFinal?.({
                    intent: mapped.intent ?? intent,
                    contextsUsed: mapped.contextsUsed ?? 0,
                    relatedCount: mapped.relatedArticles.length,
                    sourceCount: mapped.sources.length,
                    provider: "agent",
                  });
                } catch (error) {
                  console.error("[agent-client] final callback failed:", error);
                }
              }
              emit("done", {
                answer: mapped.answer,
                intent: mapped.intent,
                sources: mapped.sources,
                relatedArticles: mapped.relatedArticles,
                warnings: mapped.warnings,
                contexts_used: mapped.contextsUsed ?? 0,
                provider: "agent",
                clarification_state: mapped.clarificationState ?? null,
              });
              continue;
            }

            if (eventName === "error") {
              await markFailed();
              emit("error", {
                message:
                  typeof payload.message === "string"
                    ? payload.message
                    : "生成失败，请稍后重试。",
              });
            }
          }
        }
        if (!finalized && !failed) {
          await markFailed();
          emit("error", { message: "回答生成中断，请稍后重试。" });
        }
      } catch (error) {
        await markFailed();
        emit("error", {
          message: "回答生成中断，本次未扣除问答额度，请稍后重试。",
        });
      } finally {
        controller.close();
      }
    },
  });
}

export async function checkPythonAgentHealth(): Promise<{
  ok: boolean;
  kbReady?: boolean;
  model?: string;
  hasApiKey?: boolean;
}> {
  const baseUrl = getAgentBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return { ok: false };
    }

    const data = (await response.json()) as {
      ok?: boolean;
      kb_ready?: boolean;
      model?: string;
      has_api_key?: boolean;
    };

    return {
      ok: Boolean(data.ok),
      kbReady: data.kb_ready,
      model: data.model,
      hasApiKey: data.has_api_key,
    };
  } catch {
    return { ok: false };
  }
}
