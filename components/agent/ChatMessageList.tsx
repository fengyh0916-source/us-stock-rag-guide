"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { trackProductEvent } from "@/lib/analytics/client";
import type { ChatResponse } from "@/lib/rag/types";

import ChatContent from "./ChatContent";
import SourceCitations from "./SourceCitations";

export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  response?: ChatResponse;
  streaming?: boolean;
};

type ChatMessageListProps = {
  messages: ChatMessage[];
};

export default function ChatMessageList({ messages }: ChatMessageListProps) {
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});

  function submitFeedback(message: ChatMessage, helpful: boolean) {
    if (feedback[message.id] !== undefined) return;
    setFeedback((current) => ({ ...current, [message.id]: helpful }));
    trackProductEvent("feedback_submitted", {
      helpful,
      intent: message.response?.intent,
      provider: message.response?.provider,
    });
  }

  return (
    <div className="flex flex-col gap-4" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((message) => {
        const isUser = message.role === "user";
        const showMeta = !isUser && message.response && !message.streaming;

        return (
          <article
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            key={message.id}
          >
            <div
              className={`max-w-[92%] rounded-2xl px-4 py-3 shadow-sm ${
                isUser
                  ? "rounded-br-md bg-slate-900 text-sm leading-6 text-white"
                  : "rounded-bl-md border border-slate-200 bg-white"
              }`}
            >
              <ChatContent
                content={message.content}
                isUser={isUser}
                streaming={Boolean(message.streaming)}
              />
              {showMeta ? (
                <>
                  <SourceCitations sources={message.response!.sources} />
                  {message.response!.relatedArticles.length > 0 ? (
                    <div className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                      <p className="text-xs font-medium text-slate-500">站内继续阅读</p>
                      <div className="flex flex-wrap gap-2">
                        {message.response!.relatedArticles.map((article) => (
                          <a
                            className="inline-flex max-w-full items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100"
                            href={article.url}
                            key={article.url}
                            onClick={() =>
                              trackProductEvent("related_article_clicked", {
                                page_type: "post",
                                page_slug: article.url.split("/").filter(Boolean).at(-1),
                                intent: message.response?.intent,
                              })
                            }
                          >
                            <span className="truncate">{article.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {message.response!.warnings.length > 0 ? (
                    <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs leading-5 text-slate-500">
                      {message.response!.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2">
                    <span className="mr-1 text-[11px] text-slate-400">这个回答有帮助吗？</span>
                    <button
                      type="button"
                      aria-label="有帮助"
                      disabled={feedback[message.id] !== undefined}
                      onClick={() => submitFeedback(message, true)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition disabled:cursor-default ${
                        feedback[message.id] === true
                          ? "bg-emerald-100 text-emerald-700"
                          : "text-slate-400 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
                      }`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="没有帮助"
                      disabled={feedback[message.id] !== undefined}
                      onClick={() => submitFeedback(message, false)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition disabled:cursor-default ${
                        feedback[message.id] === false
                          ? "bg-rose-100 text-rose-700"
                          : "text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                      }`}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
