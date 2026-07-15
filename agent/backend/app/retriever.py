"""基于 BM25 + 中文分词的检索器。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import List, Optional

import jieba
from rank_bm25 import BM25Okapi

from .chunking import Chunk

# 预热词典，减少首次延迟
jieba.initialize()


def _tokenize(text: str) -> List[str]:
    text = text.lower()
    # 保留英文代码/缩写
    text = re.sub(r"([a-z0-9\+\.]+)", r" \1 ", text)
    tokens = [t.strip() for t in jieba.lcut_for_search(text) if t.strip()]
    # 过滤单字虚词
    stop = {"的", "了", "和", "是", "在", "我", "有", "就", "不", "人", "都", "一", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这"}
    return [
        t
        for t in tokens
        if (t not in stop and len(t) > 1) or re.match(r"^[a-z0-9\.]+$", t)
    ]


class Retriever:
    def __init__(self, chunks: List[Chunk]):
        self.chunks = chunks
        corpus = []
        for c in chunks:
            doc = f"{c.chapter} {c.section} {' '.join(c.tags)} {c.text}"
            corpus.append(_tokenize(doc))
        self.bm25 = BM25Okapi(corpus)

    @classmethod
    def load(cls, chunks_path: Path) -> "Retriever":
        data = json.loads(chunks_path.read_text(encoding="utf-8"))
        chunks = [Chunk.from_dict(d) for d in data]
        return cls(chunks)

    def search(
        self,
        query: str,
        top_k: int = 5,
        tag_filter: Optional[str] = None,
    ) -> List[dict]:
        tokens = _tokenize(query)
        if not tokens:
            tokens = list(query)
        scores = self.bm25.get_scores(tokens)

        # 英文专有名词/关键词额外加分（BM25 对短英文有时不够稳）
        q_lower = query.lower()
        boost_terms = []
        for term in [
            "crs",
            "fatca",
            "itin",
            "firstrade",
            "schwab",
            "ibkr",
            "ib",
            "qdii",
            "carf",
            "wise",
            "bit",
            "港卡",
            "香港",
            "出金",
            "入金",
            "券商",
            "税务",
        ]:
            if term in q_lower or term in query:
                boost_terms.append(term)

        candidates = []
        for i, score in enumerate(scores):
            c = self.chunks[i]
            title = f"{c.chapter} {c.section}".lower()
            body = c.text.lower()
            boost = 0.0
            for term in boost_terms:
                t = term.lower()
                # 标题命中权重最高（如小节名「3.1 CRS」）
                if t in title:
                    boost += 6.0
                elif t in body:
                    boost += 1.5
            # 问题词出现在小节标题时再加分
            for tok in tokens:
                if len(tok) >= 2 and tok in title:
                    boost += 1.2
            score = float(score) + boost
            if tag_filter and tag_filter not in c.tags and tag_filter != "综合":
                score = score * 0.45
            candidates.append((score, c))

        candidates.sort(key=lambda x: x[0], reverse=True)
        results = []
        for score, c in candidates[:top_k]:
            if score <= 0 and results:
                break
            results.append(
                {
                    "id": c.id,
                    "text": c.text,
                    "chapter": c.chapter,
                    "section": c.section,
                    "page_start": c.page_start,
                    "page_end": c.page_end,
                    "tags": c.tags,
                    "url": getattr(c, "url", "") or "",
                    "source": getattr(c, "source", "pdf") or "pdf",
                    "score": float(score),
                }
            )
        return results
