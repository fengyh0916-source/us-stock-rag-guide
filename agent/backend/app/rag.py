"""RAG 生成：检索 + DeepSeek 调用。"""

from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator, Dict, List, Optional

from openai import AsyncOpenAI

from .agent import (
    ClarificationDecision,
    Intent,
    build_effective_question,
    chitchat_reply,
    classify_intent,
    clarification_reply,
    compose_question_from_history,
    continue_clarification,
    guess_tag,
    history_has_pending_clarify,
    refuse_reply,
    start_clarification,
)
from .config import get_settings, is_production
from .prompts import DISCLAIMER, SYSTEM_PROMPT, build_user_prompt
from .retriever import Retriever

# 兜底去掉模型仍可能输出的出处备注
_CITE_PATTERNS = [
    re.compile(r"[（(]\s*参见[^）)]*[）)]"),
    re.compile(r"[（(]\s*参考[^）)]*[）)]"),
    re.compile(r"[（(]\s*来源[^）)]*[）)]"),
    re.compile(r"[（(]\s*见\s*第?\s*\d+\s*章[^）)]*[）)]"),
    re.compile(r"[（(]\s*\d+\.\d+[^）)]*[）)]"),
    re.compile(r"根据(?:参考)?(?:资料|文档|材料)[，,]?"),
    re.compile(r"参考资料(?:显示|指出|提到|中)?[，,]?"),
    re.compile(r"(?:现有|上述|本)?(?:科普)?文档(?:中|里|显示|指出|提到)?[，,]?"),
    re.compile(r"知识库(?:中|里|显示)?[，,]?"),
]


def _strip_citation_notes(text: str) -> str:
    if not text:
        return text
    cleaned = text
    for pat in _CITE_PATTERNS:
        cleaned = pat.sub("", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" *\n", "\n", cleaned)
    return cleaned.strip()


def _strip_markdown(text: str) -> str:
    """Remove common Markdown markers so UI can show plain structured text."""
    if not text:
        return text
    cleaned = text.replace("\r\n", "\n")
    cleaned = re.sub(r"```[\w]*\n?([\s\S]*?)```", r"\1", cleaned)
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s+", "", cleaned, flags=re.M)
    cleaned = re.sub(r"\*\*\*(.+?)\*\*\*", r"\1", cleaned)
    cleaned = re.sub(r"\*\*(.+?)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"__(.+?)__", r"\1", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r"\1", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", cleaned)
    cleaned = re.sub(r"^\s{0,3}>\s?", "", cleaned, flags=re.M)
    cleaned = re.sub(r"^\s*[-*+]\s+", "· ", cleaned, flags=re.M)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _ensure_disclaimer(text: str) -> str:
    text = _strip_markdown(_strip_citation_notes(text))
    if "仅供科普" in text or "不构成投资" in text:
        return text
    return text.rstrip() + "\n\n" + DISCLAIMER


def _citations(contexts: List[dict]) -> List[dict]:
    seen = set()
    cites = []
    for c in contexts:
        key = (c.get("chapter"), c.get("section"), c.get("page_start"), c.get("url"))
        if key in seen:
            continue
        seen.add(key)
        cites.append(
            {
                "chapter": c.get("chapter", ""),
                "section": c.get("section", ""),
                "page_start": c.get("page_start"),
                "page_end": c.get("page_end"),
                "id": c.get("id"),
                "url": c.get("url") or "",
                "source": c.get("source") or "pdf",
            }
        )
    return cites[:5]


class RAGService:
    def __init__(self, retriever: Retriever):
        self.retriever = retriever
        self.settings = get_settings()

    def _client(self) -> AsyncOpenAI:
        if not self.settings.deepseek_api_key:
            raise RuntimeError("未配置 DEEPSEEK_API_KEY，请在项目根目录 .env 中填写。")
        return AsyncOpenAI(
            api_key=self.settings.deepseek_api_key,
            base_url=self.settings.deepseek_base_url,
        )

    def _extra_body(self) -> dict:
        # DeepSeek V4 thinking 模式；关闭以省成本、降延迟
        return {"thinking": {"type": "disabled"}} if not self.settings.enable_thinking else {}

    def _prepare_turn(
        self,
        message: str,
        history: Optional[List[dict]],
        clarification_state: Optional[dict],
    ) -> tuple[Intent, str, bool, Optional[ClarificationDecision]]:
        """决定本轮追问或回答；显式状态优先，历史文本仅作旧客户端兼容。"""
        intent = classify_intent(message, history)

        if not self.settings.enable_clarification:
            # 产品策略已下线追问：即使内部分类认为问题偏宽，
            # 也直接走 RAG 给概览答案。安全拒答和闲聊仍保持原路由。
            if intent in (Intent.CLARIFY, Intent.GUIDE):
                intent = Intent.KNOWLEDGE
            if clarification_state and intent not in (Intent.REFUSE, Intent.CHITCHAT):
                # 兼容已打开页面里遗留的旧澄清状态：不再追问，
                # 把已收集的信息合并后直接回答。
                decision = continue_clarification(message, clarification_state)
                if decision.action == "restart":
                    effective_q = decision.effective_question or message
                elif decision.action == "answer":
                    effective_q = decision.effective_question
                else:
                    effective_q = build_effective_question(decision.state or clarification_state)
                return Intent.KNOWLEDGE, effective_q, True, None
            return intent, message, False, None

        if clarification_state:
            # 安全拒答与明确闲聊优先于未完成的澄清任务。
            if intent in (Intent.REFUSE, Intent.CHITCHAT):
                return intent, message, False, None
            decision = continue_clarification(message, clarification_state)
            if decision.action == "ask":
                return Intent.CLARIFY, message, True, decision
            if decision.action == "answer":
                return Intent.KNOWLEDGE, decision.effective_question, True, decision
            # 用户提出了一个新的、可独立理解的问题，丢弃旧状态重新路由。
            message = decision.effective_question or message
            intent = classify_intent(message, None)
            if intent in (Intent.CLARIFY, Intent.GUIDE):
                return Intent.CLARIFY, message, False, start_clarification(message)
            return intent, message, False, None

        after_clarify = history_has_pending_clarify(history)
        effective_q = (
            compose_question_from_history(message, history) if after_clarify else message
        )
        if intent in (Intent.CLARIFY, Intent.GUIDE) and not after_clarify:
            decision = start_clarification(message)
            return Intent.CLARIFY, message, False, decision
        return intent, effective_q, after_clarify, None

    @staticmethod
    def _clarification_payload(decision: ClarificationDecision) -> Dict[str, Any]:
        answer = clarification_reply(decision.question)
        return {
            "answer": answer,
            "intent": Intent.CLARIFY.value,
            "citations": [],
            "contexts_used": 0,
            "clarification_state": decision.state,
        }

    async def chat(
        self,
        message: str,
        history: Optional[List[dict]] = None,
        clarification_state: Optional[dict] = None,
    ) -> Dict[str, Any]:
        intent, effective_q, after_clarify, clarify_decision = self._prepare_turn(
            message, history, clarification_state
        )

        if clarify_decision and clarify_decision.action == "ask":
            return self._clarification_payload(clarify_decision)

        if intent == Intent.REFUSE:
            return {
                "answer": refuse_reply(),
                "intent": intent.value,
                "citations": [],
                "contexts_used": 0,
                "clarification_state": None,
            }

        if intent == Intent.CHITCHAT:
            return {
                "answer": chitchat_reply(message),
                "intent": intent.value,
                "citations": [],
                "contexts_used": 0,
                "clarification_state": None,
            }

        tag = guess_tag(effective_q) or guess_tag(message)
        contexts = self.retriever.search(
            effective_q,
            top_k=self.settings.top_k,
            tag_filter=tag,
        )

        if not contexts or (contexts and contexts[0].get("score", 0) <= 0):
            answer = (
                "这一点我暂时没法准确说明（掌握的信息不够）。\n\n"
                "你可以换个问法，例如：要从头了解该先弄清什么、要办哪些账户、"
                "钱怎么转进去、券商怎么选、税务要注意什么。也可以点下方快捷问题。\n\n"
                + DISCLAIMER
            )
            return {
                "answer": answer,
                "intent": Intent.KNOWLEDGE.value,
                "citations": [],
                "contexts_used": 0,
                "clarification_state": None,
            }

        client = self._client()
        user_prompt = build_user_prompt(
            effective_q,
            contexts,
            history,
            after_clarify=after_clarify,
        )
        kwargs: dict = {
            "model": self.settings.deepseek_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
            "max_tokens": 800,
        }
        extra = self._extra_body()
        if extra:
            kwargs["extra_body"] = extra

        resp = await client.chat.completions.create(**kwargs)
        content = (resp.choices[0].message.content or "").strip()
        answer = _ensure_disclaimer(content)
        raw_usage = getattr(resp, "usage", None)
        usage = {
            "prompt_tokens": int(getattr(raw_usage, "prompt_tokens", 0) or 0),
            "completion_tokens": int(getattr(raw_usage, "completion_tokens", 0) or 0),
            "total_tokens": int(getattr(raw_usage, "total_tokens", 0) or 0),
        }

        return {
            "answer": answer,
            "intent": Intent.KNOWLEDGE.value,
            "citations": _citations(contexts),
            "contexts_used": len(contexts),
            "clarification_state": None,
            "usage": usage,
        }

    async def chat_stream(
        self,
        message: str,
        history: Optional[List[dict]] = None,
        clarification_state: Optional[dict] = None,
    ) -> AsyncIterator[str]:
        """SSE 数据帧：meta / token / done / error。"""
        intent, effective_q, after_clarify, clarify_decision = self._prepare_turn(
            message, history, clarification_state
        )

        if clarify_decision and clarify_decision.action == "ask":
            payload = self._clarification_payload(clarify_decision)
            yield _sse(
                "meta",
                {
                    "intent": Intent.CLARIFY.value,
                    "citations": [],
                    "clarification_state": clarify_decision.state,
                },
            )
            yield _sse("token", {"text": payload["answer"]})
            yield _sse("done", payload)
            return

        if intent in (Intent.REFUSE, Intent.CHITCHAT):
            if intent == Intent.REFUSE:
                answer = refuse_reply()
            else:
                answer = chitchat_reply(message)
            payload = {
                "answer": answer,
                "intent": intent.value,
                "citations": [],
                "contexts_used": 0,
                "clarification_state": None,
            }
            yield _sse(
                "meta",
                {"intent": intent.value, "citations": [], "clarification_state": None},
            )
            yield _sse("token", {"text": answer})
            yield _sse("done", payload)
            return

        tag = guess_tag(effective_q) or guess_tag(message)
        contexts = self.retriever.search(
            effective_q, top_k=self.settings.top_k, tag_filter=tag
        )
        cites = _citations(contexts) if contexts else []
        yield _sse(
            "meta",
            {
                "intent": Intent.KNOWLEDGE.value,
                "citations": cites,
                "clarification_state": None,
            },
        )

        if not contexts or contexts[0].get("score", 0) <= 0:
            answer = (
                "这一点我暂时没法准确说明（掌握的信息不够）。\n\n"
                "你可以换个问法，例如：要从头了解该先弄清什么、要办哪些账户、"
                "钱怎么转进去、券商怎么选、税务要注意什么。也可以点下方快捷问题。\n\n"
                + DISCLAIMER
            )
            yield _sse("token", {"text": answer})
            yield _sse(
                "done",
                {
                    "answer": answer,
                    "intent": Intent.KNOWLEDGE.value,
                    "citations": [],
                    "contexts_used": 0,
                    "clarification_state": None,
                },
            )
            return

        try:
            client = self._client()
            user_prompt = build_user_prompt(
                effective_q,
                contexts,
                history,
                after_clarify=after_clarify,
            )
            kwargs: dict = {
                "model": self.settings.deepseek_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0,
                "max_tokens": 800,
                "stream": True,
            }
            extra = self._extra_body()
            if extra:
                kwargs["extra_body"] = extra

            full = []
            stream = await client.chat.completions.create(**kwargs)
            async for event in stream:
                if not event.choices:
                    continue
                delta = event.choices[0].delta
                piece = getattr(delta, "content", None) or ""
                if piece:
                    full.append(piece)
                    yield _sse("token", {"text": piece})

            answer = _ensure_disclaimer("".join(full).strip())
            # 若模型没输出免责，补发一段
            if not ("".join(full).strip().endswith(DISCLAIMER) or "仅供科普" in "".join(full)):
                tail = "\n\n" + DISCLAIMER
                yield _sse("token", {"text": tail})

            yield _sse(
                "done",
                {
                    "answer": answer,
                    "intent": Intent.KNOWLEDGE.value,
                    "citations": cites,
                    "contexts_used": len(contexts),
                    "clarification_state": None,
                },
            )
        except Exception as e:
            message = "回答生成失败，请稍后重试。" if is_production() else str(e)
            yield _sse("error", {"message": message})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
