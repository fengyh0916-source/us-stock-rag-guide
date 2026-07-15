"""FastAPI 入口：API + 静态前端。"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Deque, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import (
    CHUNKS_PATH,
    FRONTEND_DIR,
    cors_origins,
    get_settings,
    is_production,
    validate_production_settings,
)
from .rag import RAGService
from .retriever import Retriever

app = FastAPI(
    title="美股投资扫盲 Agent",
    description="基于《中国人投资美股指南》的科普 RAG 助手",
    version="1.0.0",
)

_origins = cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_rag: Optional[RAGService] = None
_hits: Dict[str, Deque[float]] = defaultdict(deque)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class ClarificationState(BaseModel):
    original_question: str = Field(..., min_length=1, max_length=2000)
    topic: str = Field(..., min_length=1, max_length=40)
    asked_count: int = Field(..., ge=0, le=2)
    pending_slot: str = Field(..., min_length=1, max_length=60)
    collected: Dict[str, str] = Field(default_factory=dict)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: Optional[List[ChatMessage]] = Field(default=None, max_length=8)
    clarification_state: Optional[ClarificationState] = None


def _turn_requires_model(
    message: str,
    history: List[dict],
    clarification_state: Optional[dict],
) -> bool:
    """无 API Key 时仍允许安全回复和纯澄清回合。"""
    from .agent import Intent, classify_intent, continue_clarification

    intent = classify_intent(message, history)
    settings = get_settings()
    if not settings.enable_clarification:
        return intent not in (Intent.REFUSE, Intent.CHITCHAT)
    if intent in (Intent.REFUSE, Intent.CHITCHAT):
        return False
    if clarification_state:
        decision = continue_clarification(message, clarification_state)
        if decision.action == "ask":
            return False
        if decision.action == "restart":
            restarted = classify_intent(decision.effective_question or message, None)
            return restarted not in (
                Intent.REFUSE,
                Intent.CHITCHAT,
                Intent.CLARIFY,
                Intent.GUIDE,
            )
        return True
    return intent not in (
        Intent.REFUSE,
        Intent.CHITCHAT,
        Intent.CLARIFY,
        Intent.GUIDE,
    )


def get_rag() -> RAGService:
    global _rag
    if _rag is None:
        if not CHUNKS_PATH.exists():
            raise HTTPException(
                status_code=503,
                detail="知识库未构建。请先运行：python -m scripts.ingest",
            )
        _rag = RAGService(Retriever.load(CHUNKS_PATH))
    return _rag


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limit(request: Request) -> None:
    settings = get_settings()
    limit = settings.rate_limit_per_minute
    if limit <= 0:
        return
    ip = _client_ip(request)
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试。")
    q.append(now)


@app.on_event("startup")
def startup() -> None:
    validate_production_settings()
    # 预加载知识库
    if CHUNKS_PATH.exists():
        get_rag()


@app.get("/api/health")
def health():
    return {
        "ok": True,
    }


@app.get("/api/quick-questions")
def quick_questions():
    """快捷问题（用户指定）。"""
    return {
        "questions": [
            "普通人该怎么买美股？",
            "美股是什么？为什么值得买？",
            "该怎么出入金？",
            "有哪些推荐的券商？",
        ]
    }


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    _rate_limit(request)
    settings = get_settings()
    history = [h.model_dump() for h in (req.history or [])]
    clarification_state = (
        req.clarification_state.model_dump() if req.clarification_state else None
    )
    if not settings.deepseek_api_key:
        if _turn_requires_model(req.message, history, clarification_state):
            raise HTTPException(
                status_code=503,
                detail="服务端未配置 DEEPSEEK_API_KEY。",
            )
    rag = get_rag()
    try:
        return await rag.chat(req.message, history, clarification_state)
    except RuntimeError as e:
        detail = "AI 服务暂时不可用，请稍后重试。" if is_production() else str(e)
        raise HTTPException(status_code=503, detail=detail)
    except Exception as e:
        detail = "回答生成失败，请稍后重试。" if is_production() else f"生成失败：{e}"
        raise HTTPException(status_code=500, detail=detail)


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    _rate_limit(request)
    settings = get_settings()
    history = [h.model_dump() for h in (req.history or [])]
    clarification_state = (
        req.clarification_state.model_dump() if req.clarification_state else None
    )
    if not settings.deepseek_api_key:
        if _turn_requires_model(req.message, history, clarification_state):
            raise HTTPException(
                status_code=503,
                detail="服务端未配置 DEEPSEEK_API_KEY。",
            )
    rag = get_rag()

    async def gen():
        async for chunk in rag.chat_stream(req.message, history, clarification_state):
            yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream")


# 静态前端
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(FRONTEND_DIR / "index.html")
