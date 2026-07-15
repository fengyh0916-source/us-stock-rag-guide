#!/usr/bin/env python3
"""
不调用 API：基于 latest_full_rag_raw.json + full_eval_set.json
重算 Precision@K / Recall@K / Hit@K，并汇总已有忠实度、相关性。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
RAW = Path(__file__).parent / "results" / "latest_full_rag_raw.json"
EVAL_SET = Path(__file__).parent / "full_eval_set.json"
OUT_DIR = Path(__file__).parent / "results"
K = 5


def parse_top(item: str) -> Dict[str, Any]:
    # "section|tag1,tag2|p12"
    parts = item.split("|")
    section = parts[0] if parts else ""
    tags = []
    page = None
    if len(parts) >= 2:
        tags = [t.strip() for t in parts[1].split(",") if t.strip()]
    if len(parts) >= 3 and parts[2].startswith("p"):
        try:
            page = int(parts[2][1:].split("-")[0])
        except ValueError:
            page = None
    return {"section": section, "tags": tags, "page": page, "raw": item}


def chunk_matches(chunk: dict, gold_tags: List[str], gold_kws: List[str]) -> Tuple[bool, List[str]]:
    """返回是否相关，以及命中了哪些金标方面（tags/keywords）。"""
    hit_aspects = []
    blob = (chunk.get("section") or "") + " " + ",".join(chunk.get("tags") or [])
    blob_l = blob.lower()
    tags = chunk.get("tags") or []

    for t in gold_tags:
        if t in tags or t in blob:
            hit_aspects.append(f"tag:{t}")
    for kw in gold_kws:
        if kw.lower() in blob_l or kw in blob:
            hit_aspects.append(f"kw:{kw}")
    # 去重保持顺序
    seen = set()
    uniq = []
    for a in hit_aspects:
        if a not in seen:
            seen.add(a)
            uniq.append(a)
    return len(uniq) > 0, uniq


def score_retrieval_pr(
    top_sections: List[str],
    gold_tags: List[str],
    gold_kws: List[str],
    k: int = K,
) -> Dict[str, Any]:
    gold_tags = gold_tags or []
    gold_kws = gold_kws or []
    aspects = [f"tag:{t}" for t in gold_tags] + [f"kw:{kw}" for kw in gold_kws]
    # 无金标：不计入宏平均 P/R（或标 N/A）
    if not aspects:
        return {
            "applicable": False,
            "precision_at_k": None,
            "recall_at_k": None,
            "hit_at_k": None,
            "relevant_in_topk": None,
            "k": k,
            "matched_aspects": [],
            "all_aspects": [],
            "detail": "无金标，跳过 P/R",
        }

    chunks = [parse_top(s) for s in (top_sections or [])[:k]]
    # pad: if fewer than k returned, precision denominator = actual returned count (common) or k
    n_ret = max(len(chunks), 1) if chunks else 0
    if n_ret == 0:
        return {
            "applicable": True,
            "precision_at_k": 0.0,
            "recall_at_k": 0.0,
            "hit_at_k": 0,
            "relevant_in_topk": 0,
            "k": k,
            "matched_aspects": [],
            "all_aspects": aspects,
            "detail": "检索结果为空",
            "per_chunk_relevant": [],
        }

    per_rel = []
    all_matched = []
    rel_count = 0
    for c in chunks:
        rel, matched = chunk_matches(c, gold_tags, gold_kws)
        per_rel.append({"section": c["section"], "relevant": rel, "matched": matched})
        if rel:
            rel_count += 1
            all_matched.extend(matched)

    matched_set = []
    seen = set()
    for a in all_matched:
        if a not in seen:
            seen.add(a)
            matched_set.append(a)

    # Precision@K: 相关条数 / min(K, 返回条数) —— 用实际返回条数作分母更诚实
    denom_p = len(chunks)
    precision = rel_count / denom_p

    # Recall@K: 金标「方面」被覆盖的比例（多标签召回，适配无 chunk-id 金标的情况）
    recall = len([a for a in aspects if a in set(matched_set)]) / len(aspects)

    # Hit@K: 是否至少一条相关
    hit = 1 if rel_count > 0 else 0

    return {
        "applicable": True,
        "precision_at_k": round(precision, 4),
        "recall_at_k": round(recall, 4),
        "hit_at_k": hit,
        "relevant_in_topk": rel_count,
        "k": denom_p,
        "matched_aspects": matched_set,
        "all_aspects": aspects,
        "detail": f"相关段{rel_count}/{denom_p}；方面{len(matched_set)}/{len(aspects)}",
        "per_chunk_relevant": per_rel,
    }


def main() -> None:
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    cases = {c["id"]: c for c in json.loads(EVAL_SET.read_text(encoding="utf-8"))}
    results = raw["results"]

    rows = []
    for r in results:
        cid = r["id"]
        case = cases.get(cid, {})
        top = (r.get("retrieval") or {}).get("top_sections") or []
        gold_tags = case.get("gold_tags") or []
        gold_kws = case.get("gold_section_keywords") or []
        mode = case.get("mode") or r.get("mode")

        # 仅对有检索结果的知识向题目算 P/R；安全/闲聊跳过
        is_ragish = r.get("category") in ("rag", "hallucination") or mode in (
            "rag",
            "rag_or_abstain",
        )
        # G03 ood 有 top 也可算但不强制
        if not is_ragish or mode in ("refuse", "chitchat", "guide"):
            pr = {
                "applicable": False,
                "precision_at_k": None,
                "recall_at_k": None,
                "hit_at_k": None,
                "detail": "非检索主评题",
            }
        else:
            pr = score_retrieval_pr(top, gold_tags, gold_kws, K)

        judge = r.get("judge") or {}
        rows.append(
            {
                "id": cid,
                "category": r.get("category"),
                "question": r.get("question"),
                "retrieval_pr": pr,
                "faithfulness": judge.get("faithfulness"),
                "answer_relevance": judge.get("answer_relevance"),
                "faithfulness_score_100": judge.get("faithfulness_score_100"),
                "relevance_score_100": judge.get("relevance_score_100"),
                "has_hallucination": judge.get("has_hallucination"),
                "judge_reason": judge.get("brief_reason"),
                "old_hit": (r.get("retrieval") or {}).get("hit_at_k"),
                "intent": r.get("intent"),
                "total_score_old": r.get("total_score"),
                "grade_old": r.get("grade"),
            }
        )

    # 宏平均：仅 applicable 且有金标
    pr_rows = [x for x in rows if x["retrieval_pr"].get("applicable")]
    n = len(pr_rows)
    avg_p = sum(x["retrieval_pr"]["precision_at_k"] for x in pr_rows) / n if n else None
    avg_r = sum(x["retrieval_pr"]["recall_at_k"] for x in pr_rows) / n if n else None
    hit_rate = sum(x["retrieval_pr"]["hit_at_k"] for x in pr_rows) / n if n else None

    # 生成层：有 judge 分数的
    gen_rows = [
        x
        for x in rows
        if x.get("faithfulness") is not None and x.get("answer_relevance") is not None
    ]
    # 知识题优先
    gen_rag = [x for x in gen_rows if x.get("category") == "rag"]
    use_gen = gen_rag if gen_rag else gen_rows
    avg_f = (
        sum(x["faithfulness"] for x in use_gen) / len(use_gen) if use_gen else None
    )
    avg_ar = (
        sum(x["answer_relevance"] for x in use_gen) / len(use_gen) if use_gen else None
    )
    hall_rate = (
        sum(1 for x in use_gen if x.get("has_hallucination")) / len(use_gen)
        if use_gen
        else None
    )

    payload = {
        "meta": {
            "time": datetime.now().isoformat(timespec="seconds"),
            "source_raw": str(RAW.name),
            "note": "未重新调用 API；检索 P/R/Hit 由 raw 中 top_sections + 金标重算；忠实度/相关沿用上次 LLM Judge",
            "k": K,
            "n_retrieval_scored": n,
            "macro_precision_at_k": round(avg_p, 4) if avg_p is not None else None,
            "macro_recall_at_k": round(avg_r, 4) if avg_r is not None else None,
            "hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
            "n_generation_scored": len(use_gen),
            "avg_faithfulness_1to5": round(avg_f, 3) if avg_f is not None else None,
            "avg_answer_relevance_1to5": round(avg_ar, 3) if avg_ar is not None else None,
            "hallucination_rate": round(hall_rate, 4) if hall_rate is not None else None,
        },
        "rows": rows,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw_out = OUT_DIR / "rescore_pr_latest.json"
    raw_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Markdown report
    L = []
    L.append("# 重算评测报告（无新 API 调用）")
    L.append("")
    L.append(f"- **时间**: {payload['meta']['time']}")
    L.append(f"- **数据来源**: `{RAW.name}`（沿用当次回答与 Judge）")
    L.append(f"- **K**: {K}")
    L.append("")
    L.append("## 方法说明")
    L.append("")
    L.append("### 检索层（本次新算）")
    L.append("")
    L.append("对每条 Top-K 结果，若命中任一 `gold_tags` 或 `gold_section_keywords`，记为**相关段**。")
    L.append("")
    L.append("| 指标 | 定义 |")
    L.append("|------|------|")
    L.append("| **Precision@K** | 相关段数量 / 实际返回条数 |")
    L.append("| **Recall@K** | 被命中的金标「方面」(每个 tag/kw 算一个方面) / 金标方面总数 |")
    L.append("| **Hit@K** | 是否至少 1 条相关段（0/1） |")
    L.append("| **Hit Rate** | 各题 Hit@K 的平均（有金标的题） |")
    L.append("")
    L.append("> 说明：因历史 raw 只存了 section/tags 摘要而非 chunk id，Recall 采用**方面级召回**（多标签），与 IR 教科书「相关文档集合」定义等价意图一致，标注粒度不同。")
    L.append("")
    L.append("### 生成层（沿用上次，未重调 API）")
    L.append("")
    L.append("| 指标 | 定义 |")
    L.append("|------|------|")
    L.append("| **Faithfulness** | 1～5，答案相对检索片段是否有依据 |")
    L.append("| **Answer Relevance** | 1～5，是否回答用户问题 |")
    L.append("")
    L.append("## 总体结果")
    L.append("")
    L.append("| 指标 | 数值 |")
    L.append("|------|------|")
    L.append(f"| 纳入检索 P/R 的题数 | **{n}** |")
    L.append(f"| **Macro Precision@{K}** | **{avg_p*100:.1f}%** |" if avg_p is not None else "| Precision | - |")
    L.append(f"| **Macro Recall@{K}** | **{avg_r*100:.1f}%** |" if avg_r is not None else "| Recall | - |")
    L.append(f"| **Hit Rate** | **{hit_rate*100:.1f}%** |" if hit_rate is not None else "| Hit | - |")
    L.append(f"| 纳入生成评估题数（rag） | **{len(use_gen)}** |")
    L.append(f"| **平均忠实度** | **{avg_f:.2f} / 5** |" if avg_f is not None else "| 忠实度 | - |")
    L.append(f"| **平均相关性** | **{avg_ar:.2f} / 5** |" if avg_ar is not None else "| 相关 | - |")
    L.append(f"| 幻觉标记率（Judge） | **{hall_rate*100:.1f}%** |" if hall_rate is not None else "| 幻觉 | - |")
    L.append("")
    L.append("## 逐题明细")
    L.append("")
    L.append("| ID | P@K | R@K | Hit | 相关段数 | 忠实 | 相关 | 题干摘要 |")
    L.append("|----|-----|-----|-----|----------|------|------|----------|")
    for x in rows:
        pr = x["retrieval_pr"]
        if pr.get("applicable"):
            p = f"{pr['precision_at_k']*100:.0f}%"
            rc = f"{pr['recall_at_k']*100:.0f}%"
            h = str(pr["hit_at_k"])
            reln = str(pr.get("relevant_in_topk"))
        else:
            p = rc = h = reln = "-"
        f = x["faithfulness"] if x["faithfulness"] is not None else "-"
        ar = x["answer_relevance"] if x["answer_relevance"] is not None else "-"
        q = (x["question"] or "")[:28].replace("|", "\\|")
        L.append(f"| {x['id']} | {p} | {rc} | {h} | {reln} | {f} | {ar} | {q} |")

    L.append("")
    L.append("## 读数提示")
    L.append("")
    L.append("- **Hit 高、Precision 较低**：找对了方向，但 Top-K 里噪音段多。")
    L.append("- **Hit 高、Recall 较低**：命中了部分金标方面，但 tag/关键词覆盖不全。")
    L.append("- **忠实低、相关高**：话在题上，但相对材料发挥多（本次未重跑 Judge，数值同上次）。")
    L.append("")
    L.append(f"JSON: `{raw_out.name}`")
    L.append("")

    report_path = OUT_DIR / "rescore_pr_latest.md"
    report_path.write_text("\n".join(L), encoding="utf-8")
    print(json.dumps(payload["meta"], ensure_ascii=False, indent=2))
    print("Wrote", report_path)


if __name__ == "__main__":
    main()
