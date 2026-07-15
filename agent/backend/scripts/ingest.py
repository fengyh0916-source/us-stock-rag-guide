#!/usr/bin/env python3
"""将 PDF + 站内 Markdown 教程切块并写入 data/index/chunks.json。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# 保证可导入 app
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.chunking import split_into_chunks, split_posts_into_chunks  # noqa: E402
from app.config import CHUNKS_PATH, INDEX_DIR, PDF_PATH, POSTS_DIR  # noqa: E402


def main() -> None:
    all_chunks = []

    if PDF_PATH.exists():
        print(f"📄 读取 PDF：{PDF_PATH}")
        pdf_chunks = split_into_chunks(str(PDF_PATH))
        print(f"✅ PDF 切块：{len(pdf_chunks)} 块")
        all_chunks.extend(pdf_chunks)
    else:
        print(f"⚠️  找不到 PDF：{PDF_PATH}，跳过")

    if POSTS_DIR.is_dir():
        print(f"📝 读取站内教程：{POSTS_DIR}")
        start_idx = len(all_chunks) + 1
        post_chunks = split_posts_into_chunks(str(POSTS_DIR), start_idx=start_idx)
        print(f"✅ 站内教程切块：{len(post_chunks)} 块")
        all_chunks.extend(post_chunks)
    else:
        print(f"⚠️  找不到 posts 目录：{POSTS_DIR}，跳过")

    if not all_chunks:
        print("❌ 没有任何知识块可入库")
        sys.exit(1)

    # 重新编号，保证 id 唯一
    for i, c in enumerate(all_chunks, 1):
        prefix = "p" if c.source == "post" else "c"
        c.id = f"{prefix}{i:04d}"

    # 统计
    by_source = {"pdf": 0, "post": 0}
    chapters: dict[str, int] = {}
    for c in all_chunks:
        by_source[c.source] = by_source.get(c.source, 0) + 1
        chapters[c.chapter] = chapters.get(c.chapter, 0) + 1

    print(f"\n📊 合计 {len(all_chunks)} 块 | PDF {by_source.get('pdf', 0)} | 站内 {by_source.get('post', 0)}")
    print("—— 来源块数（前 15）——")
    for k, v in sorted(chapters.items(), key=lambda x: -x[1])[:15]:
        print(f"  {k[:48]}: {v}")

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    payload = [c.to_dict() for c in all_chunks]
    CHUNKS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 已写入：{CHUNKS_PATH}")

    from app.retriever import Retriever

    r = Retriever(all_chunks)
    for q in ["CRS 是什么", "众安银行开户", "盈透 IBKR", "Wise 入金", "港卡怎么在内地花"]:
        hits = r.search(q, top_k=3)
        print(f"\n🔍 测试「{q}」→")
        for h in hits:
            src = "站内" if h.get("url") else "PDF"
            print(f"   [{h['score']:.2f}] ({src}) {h['chapter'][:28]} | {h['section'][:24]}")


if __name__ == "__main__":
    main()
