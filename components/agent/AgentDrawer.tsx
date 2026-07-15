"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, ChevronRight, LoaderCircle, Send, Sparkles, X } from "lucide-react";

import type { ChatMessage } from "@/components/agent/ChatMessageList";
import ChatMessageList from "@/components/agent/ChatMessageList";
import { useAuth } from "@/components/auth/AuthProvider";
import { stripMarkdownSymbols } from "@/lib/rag/format-answer";
import { SseParser } from "@/lib/rag/sse";
import type {
  ChatHistoryMessage,
  ChatRequest,
  ChatResponse,
  ChatSource,
  ClarificationState,
} from "@/lib/rag/types";

type AgentDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  pageContext?: ChatRequest["pageContext"];
};

type QuotaState =
  | {
      role: "guest";
      limit: number;
      used: number;
      remaining: number;
      needLogin: boolean;
    }
  | {
      role: "user";
      checkedIn: boolean;
      allowance: number;
      used: number;
      remaining: number;
      reward: number;
    }
  | null;

const QUICK_QUESTIONS = [
  "普通人该怎么买美股？",
  "美股是什么？为什么值得买？",
  "该怎么出入金？",
  "有哪些推荐的券商？",
];

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "哈喽，我是小玥～可以帮你梳理开港卡、选券商、出入金和美股入门路径。游客可免费体验 3 次；登录后每日签到可获得 10 次问答。直接提问，或点下方快捷问题。",
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildHistory(messages: ChatMessage[]): ChatHistoryMessage[] {
  return messages
    .filter((message) => message.id !== "welcome" && !message.streaming)
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

type StreamMeta = {
  intent?: string;
  sources?: ChatSource[];
  relatedArticles?: ChatResponse["relatedArticles"];
  warnings?: string[];
  provider?: ChatResponse["provider"];
  clarificationState?: ClarificationState | null;
};

export default function AgentDrawer({ isOpen, onClose, pageContext }: AgentDrawerProps) {
  const { user, openLogin } = useAuth();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaState>(null);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [clarificationState, setClarificationState] = useState<ClarificationState | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** When true, keep pinning to bottom as content grows. Cleared when user scrolls up. */
  const stickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);

  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/quota", { credentials: "include" });
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as QuotaState;
      setQuota(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void refreshQuota();
  }, [isOpen, user?.id, refreshQuota]);

  const BOTTOM_THRESHOLD_PX = 80;

  function isNearBottom(el: HTMLElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
  }

  function handleMessageScroll() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickToBottomRef.current = isNearBottom(el);
  }

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) {
      return;
    }

    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!scrollRef.current || !stickToBottomRef.current) {
        return;
      }
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior,
      });
    });
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    closeButtonRef.current?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const drawer = drawerRef.current;

      if (!drawer) {
        return;
      }

      const focusableElements = Array.from(
        drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!drawer.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Desktop: push main content left; mobile: lock background scroll under sheet.
    document.body.classList.add("agent-panel-open");
    const media = window.matchMedia("(max-width: 767px)");

    function syncMobileLock() {
      if (media.matches) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
    }

    syncMobileLock();
    media.addEventListener("change", syncMobileLock);

    return () => {
      document.body.classList.remove("agent-panel-open");
      document.body.style.overflow = "";
      media.removeEventListener("change", syncMobileLock);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    // Opening the panel: jump to latest, re-enable stick-to-bottom
    stickToBottomRef.current = true;
    scrollToBottom("auto");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    // Streaming updates fire often — use instant scroll only while stuck to bottom
    const streaming = messages.some((item) => item.streaming);
    scrollToBottom(streaming ? "auto" : "smooth");
  }, [isOpen, messages, isLoading]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  async function sendMessage(
    message: string,
    stateForRequest: ClarificationState | null = clarificationState,
  ) {
    const trimmed = message.trim();

    if (!trimmed || isLoading) {
      return;
    }

    // 前端预检额度（服务端仍会强制校验）
    if (quota?.role === "guest" && quota.needLogin) {
      setError("游客免费额度已用完，请登录并签到后继续");
      openLogin("agent");
      return;
    }
    if (quota?.role === "user" && !quota.checkedIn) {
      setError("今日尚未签到，请先点击上方「每日签到」领取额度");
      return;
    }
    if (quota?.role === "user" && quota.checkedIn && quota.remaining <= 0) {
      setError("今日问答次数已用完，请明天再来签到");
      return;
    }

    // New user message: always follow the reply as it streams
    stickToBottomRef.current = true;

    setError(null);
    setIsLoading(true);
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    const history = buildHistory(messages);
    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content: trimmed,
    };
    const assistantId = createId("assistant");
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput("");

    let rawText = "";
    let meta: StreamMeta = {};

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: trimmed,
          pageContext,
          history,
          clarificationState: stateForRequest,
        } satisfies ChatRequest),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 429) {
        let code = "";
        let msg = "请求失败";
        try {
          const body = (await response.json()) as {
            error?: string;
            code?: string;
          };
          if (body.error) msg = body.error;
          if (body.code) code = body.code;
        } catch {
          /* ignore */
        }

        // 回滚刚插入的用户/助手消息
        setMessages((current) =>
          current.filter((m) => m.id !== userMessage.id && m.id !== assistantId),
        );
        setInput(trimmed);
        void refreshQuota();
        setError(msg);

        if (code === "GUEST_LIMIT" || code === "AUTH_REQUIRED") {
          openLogin("agent");
        }
        return;
      }

      if (!response.ok || !response.body) {
        let message = "AI 助手暂时不可用，请稍后重试";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) {
            message = body.error;
          }
        } catch {
          /* ignore */
        }
        void refreshQuota();
        throw new Error(message);
      }

      void refreshQuota();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const events = parser.push(decoder.decode(value, { stream: true }));

        for (const event of events) {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event.event === "meta") {
            meta = {
              intent: typeof payload.intent === "string" ? payload.intent : undefined,
              sources: Array.isArray(payload.sources)
                ? (payload.sources as ChatSource[])
                : [],
              relatedArticles: Array.isArray(payload.relatedArticles)
                ? (payload.relatedArticles as ChatResponse["relatedArticles"])
                : [],
              warnings: Array.isArray(payload.warnings)
                ? (payload.warnings as string[])
                : [],
              provider:
                payload.provider === "agent" || payload.provider === "mock"
                  ? payload.provider
                  : undefined,
              clarificationState:
                payload.clarification_state &&
                typeof payload.clarification_state === "object"
                  ? (payload.clarification_state as ClarificationState)
                  : null,
            };
            continue;
          }

          if (event.event === "token") {
            const piece = typeof payload.text === "string" ? payload.text : "";
            if (!piece) {
              continue;
            }
            rawText += piece;
            const display = stripMarkdownSymbols(rawText);
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      content: display,
                      streaming: true,
                    }
                  : item,
              ),
            );
            continue;
          }

          if (event.event === "done") {
            const finalAnswer = stripMarkdownSymbols(
              typeof payload.answer === "string" ? payload.answer : rawText,
            );
            const finalResponse: ChatResponse = {
              answer: finalAnswer,
              sources: Array.isArray(payload.sources)
                ? (payload.sources as ChatSource[])
                : meta.sources ?? [],
              relatedArticles: Array.isArray(payload.relatedArticles)
                ? (payload.relatedArticles as ChatResponse["relatedArticles"])
                : meta.relatedArticles ?? [],
              warnings: Array.isArray(payload.warnings)
                ? (payload.warnings as string[])
                : meta.warnings ?? [],
              intent:
                typeof payload.intent === "string" ? payload.intent : meta.intent,
              contextsUsed:
                typeof payload.contexts_used === "number"
                  ? payload.contexts_used
                  : undefined,
              provider:
                payload.provider === "agent" || payload.provider === "mock"
                  ? payload.provider
                  : meta.provider,
              clarificationState:
                payload.clarification_state &&
                typeof payload.clarification_state === "object"
                  ? (payload.clarification_state as ClarificationState)
                  : (meta.clarificationState ?? null),
            };

            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      content: finalAnswer,
                      streaming: false,
                      response: finalResponse,
                    }
                  : item,
              ),
            );
            setClarificationState(finalResponse.clarificationState ?? null);
            void refreshQuota();
            finished = true;
            break;
          }

          if (event.event === "error") {
            throw new Error(
              typeof payload.message === "string" ? payload.message : "stream error",
            );
          }
        }
      }

      // Stream ended without done event — finalize with whatever we have
      if (!finished) {
        if (!rawText.trim()) {
          throw new Error("empty stream");
        }

        const finalAnswer = stripMarkdownSymbols(rawText);
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: finalAnswer,
                  streaming: false,
                  response: {
                    answer: finalAnswer,
                    sources: meta.sources ?? [],
                    relatedArticles: meta.relatedArticles ?? [],
                    warnings: meta.warnings ?? [],
                    intent: meta.intent,
                    provider: meta.provider,
                    clarificationState: meta.clarificationState ?? null,
                  },
                }
              : item,
          ),
        );
        setClarificationState(meta.clarificationState ?? null);
        void refreshQuota();
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      setInput(trimmed);
      setMessages((current) =>
        current.filter((item) => item.id !== userMessage.id && item.id !== assistantId),
      );
      setError(
        err instanceof Error && err.message
          ? `发送失败：${err.message}`
          : "发送失败，已保留你的输入。请稍后重试。",
      );
      void refreshQuota();
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleQuickQuestion(question: string) {
    setClarificationState(null);
    void sendMessage(question, null);
  }

  async function handleCheckIn() {
    if (!user) {
      openLogin("agent");
      return;
    }
    setCheckInBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/check-in", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        role?: string;
        remaining?: number;
        allowance?: number;
        checkedIn?: boolean;
        used?: number;
        reward?: number;
      };
      if (!res.ok) {
        setError(data.error || "签到失败");
        return;
      }
      await refreshQuota();
      setError(null);
      // 签到成功不插入聊天气泡，避免挡住快捷问题；额度文案会在顶部更新
    } catch {
      setError("签到失败，请稍后重试");
    } finally {
      setCheckInBusy(false);
    }
  }

  const quotaLabel = (() => {
    if (!quota) return null;
    if (quota.role === "guest") {
      return `游客剩余 ${quota.remaining}/${quota.limit} 次`;
    }
    if (!quota.checkedIn) {
      return "今日未签到";
    }
    return `今日剩余 ${quota.remaining}/${quota.allowance} 次`;
  })();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 md:pointer-events-none" aria-labelledby="agent-drawer-title">
      {/* Mobile overlay only — desktop keeps the page visible like Alibaba */}
      <button
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/25 backdrop-blur-[1px] md:hidden"
        type="button"
        tabIndex={-1}
        aria-label="关闭美股扫盲小助手"
        onClick={onClose}
      />

      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        className="agent-side-panel pointer-events-auto absolute inset-y-0 right-0 flex h-dvh w-full max-w-none flex-col overflow-hidden border-l border-slate-200/90 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.08)] md:w-[var(--agent-panel-width)] md:max-w-[var(--agent-panel-width)]"
      >
        <header className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:py-4">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-sky-50 ring-1 ring-sky-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/mascot/assistant-avatar.png"
                alt=""
                className="h-full w-full object-cover object-top"
                draggable={false}
              />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-950 sm:text-[15px]" id="agent-drawer-title">
                  小玥 · 美股扫盲助手
                </h2>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">
                  在线
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-[13px]">
                开港卡、选券商、出入金相关都可以问我
                {quotaLabel ? (
                  <span className="mt-0.5 block text-[11px] font-medium text-sky-700">
                    {quotaLabel}
                  </span>
                ) : null}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              aria-label="关闭助手"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          {user && quota?.role === "user" && !quota.checkedIn ? (
            <button
              type="button"
              disabled={checkInBusy}
              onClick={() => void handleCheckIn()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {checkInBusy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CalendarCheck className="h-4 w-4" aria-hidden />
              )}
              每日签到 · 领取 {quota.reward} 次问答
            </button>
          ) : null}
          {user && quota?.role === "user" && quota.checkedIn && quota.remaining <= 0 ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
              今日额度已用完，明天再来签到吧
            </p>
          ) : null}
          {!user && quota?.role === "guest" && quota.needLogin ? (
            <button
              type="button"
              onClick={() => openLogin("agent")}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d0d0d] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
            >
              免费额度已用完 · 登录继续问
            </button>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-[#f8fafc]">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
            onScroll={handleMessageScroll}
          >
            <ChatMessageList messages={messages} />

            {/* 欢迎态：快捷问题紧跟气泡下方，上下排列 */}
            {messages.length === 1 && messages[0]?.id === "welcome" && !isLoading ? (
              <div className="mt-3.5 max-w-[92%]" aria-label="快捷问题">
                <div className="mb-2 flex items-center gap-1.5 px-0.5">
                  <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-sky-500" />
                  <p className="text-[11px] font-medium tracking-wide text-slate-400">
                    试试这样问
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {QUICK_QUESTIONS.map((question) => (
                    <button
                      className="group flex w-full items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-150 hover:-translate-y-px hover:border-sky-300 hover:bg-gradient-to-r hover:from-sky-50 hover:to-white hover:shadow-[0_4px_12px_rgba(14,165,233,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      disabled={isLoading}
                      key={question}
                      onClick={() => handleQuickQuestion(question)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-[11px] font-semibold tabular-nums text-sky-600 ring-1 ring-inset ring-sky-100 transition group-hover:bg-sky-100 group-hover:text-sky-700"
                      >
                        ?
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-slate-700 transition group-hover:text-sky-900">
                        {question}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-sky-500"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {isLoading && !messages.some((item) => item.streaming) ? (
              <div className="mt-4 flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                  正在连接助手...
                </div>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-slate-200/80 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
            {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

            <form
              className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-sm focus-within:border-sky-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100"
              onSubmit={handleSubmit}
            >
              <label className="sr-only" htmlFor="agent-chat-input">
                输入问题
              </label>
              <textarea
                className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-5 text-slate-900 outline-none placeholder:text-slate-400 sm:text-sm"
                id="agent-chat-input"
                disabled={isLoading}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }}
                placeholder="请输入你有什么问题？"
                rows={1}
                value={input}
              />
              <button
                aria-label="发送问题"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={isLoading || input.trim().length === 0}
                type="submit"
              >
                {isLoading ? (
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Send aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </form>
            <p className="mt-2.5 text-center text-[11px] leading-4 text-slate-400">
              仅供科普参考，不构成投资、税务或法律建议
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
