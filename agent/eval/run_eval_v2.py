#!/usr/bin/env python3
"""
RAG Agent V2 评测器。

默认不调用大模型，评测检索、路由、多轮澄清和安全边界；
传入 --live-raw 后，可合并 run_full_rag_eval.py 产生的端到端结果。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

EVAL_DIR = Path(__file__).resolve().parent
ROOT = EVAL_DIR.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.agent import guess_tag  # noqa: E402
from app.config import CHUNKS_PATH  # noqa: E402
from app.rag import RAGService  # noqa: E402
from app.retriever import Retriever  # noqa: E402

FULL_SET_PATH = EVAL_DIR / "full_eval_set.json"
INTERACTION_SET_PATH = EVAL_DIR / "interaction_eval_set.json"
CONFIG_PATH = EVAL_DIR / "eval_config.json"
DEFAULT_OUT_DIR = EVAL_DIR / "results"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()[:16]


def percentile(values: Sequence[float], p: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    pos = (len(ordered) - 1) * p
    lower = math.floor(pos)
    upper = math.ceil(pos)
    if lower == upper:
        return float(ordered[lower])
    return float(ordered[lower] + (ordered[upper] - ordered[lower]) * (pos - lower))


def mean(values: Iterable[float]) -> Optional[float]:
    items = list(values)
    return sum(items) / len(items) if items else None


def safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def round_metric(value: Optional[float], digits: int = 4) -> Optional[float]:
    return round(value, digits) if value is not None else None


def chunk_dict(chunk: Any) -> Dict[str, Any]:
    if isinstance(chunk, dict):
        return chunk
    if hasattr(chunk, "to_dict"):
        return chunk.to_dict()
    return {
        "id": getattr(chunk, "id", ""),
        "chapter": getattr(chunk, "chapter", ""),
        "section": getattr(chunk, "section", ""),
        "text": getattr(chunk, "text", ""),
        "tags": list(getattr(chunk, "tags", []) or []),
        "source": getattr(chunk, "source", ""),
    }


def gold_aspects(case: dict) -> List[str]:
    return [f"tag:{x}" for x in case.get("gold_tags") or []] + [
        f"kw:{x}" for x in case.get("gold_section_keywords") or []
    ]


def match_aspects(chunk: dict, case: dict) -> List[str]:
    tags = chunk.get("tags") or []
    blob = " ".join(
        [
            str(chunk.get("chapter") or ""),
            str(chunk.get("section") or ""),
            str(chunk.get("text") or ""),
        ]
    )
    blob_lower = blob.lower()
    matched: List[str] = []
    for tag in case.get("gold_tags") or []:
        if tag in tags or tag.lower() in blob_lower:
            matched.append(f"tag:{tag}")
    for keyword in case.get("gold_section_keywords") or []:
        if keyword.lower() in blob_lower:
            matched.append(f"kw:{keyword}")
    return list(dict.fromkeys(matched))


def dcg(grades: Sequence[int]) -> float:
    return sum((2**grade - 1) / math.log2(rank + 2) for rank, grade in enumerate(grades))


def score_retrieval_case(
    case: dict,
    contexts: List[dict],
    corpus: List[dict],
    top_k: int,
) -> Dict[str, Any]:
    aspects = gold_aspects(case)
    if not aspects:
        return {"applicable": False, "reason": "no_gold_aspects"}

    rows = []
    matched_union = set()
    for rank, context in enumerate(contexts[:top_k], 1):
        matched = match_aspects(context, case)
        matched_union.update(matched)
        rows.append(
            {
                "rank": rank,
                "chunk_id": context.get("id"),
                "section": context.get("section"),
                "source": context.get("source"),
                "retrieval_score": round(float(context.get("score") or 0), 4),
                "relevance_grade": len(matched),
                "matched_aspects": matched,
            }
        )

    grades = [row["relevance_grade"] for row in rows]
    grades += [0] * max(0, top_k - len(grades))
    relevant_count = sum(1 for grade in grades[:top_k] if grade > 0)
    first_rank = next((i + 1 for i, grade in enumerate(grades[:top_k]) if grade > 0), None)

    # 弱标签 nDCG：用同一 tags/关键词规则给全库 chunk 打相关性等级，
    # 再与理想排序比较。这不等同于人工 chunk-id 金标，报告会明确标注。
    ideal_grades = sorted(
        (len(match_aspects(item, case)) for item in corpus), reverse=True
    )[:top_k]
    ideal = dcg(ideal_grades)
    ndcg = safe_div(dcg(grades[:top_k]), ideal)

    return {
        "applicable": True,
        "hit_at_k": 1 if relevant_count else 0,
        "precision_at_k": relevant_count / top_k,
        "aspect_recall_at_k": safe_div(len(matched_union), len(aspects)),
        "mrr": 1 / first_rank if first_rank else 0.0,
        "ndcg_at_k": ndcg,
        "first_relevant_rank": first_rank,
        "matched_aspects": sorted(matched_union),
        "gold_aspects": aspects,
        "top_chunks": rows,
    }


def evaluate_retrieval(
    retriever: Retriever, cases: List[dict], top_k: int
) -> Tuple[Dict[str, Any], List[dict], List[str]]:
    corpus = [chunk_dict(chunk) for chunk in retriever.chunks]
    rows: List[dict] = []
    errors: List[str] = []
    latencies_ms: List[float] = []

    for case in cases:
        if case.get("category") != "rag" or not gold_aspects(case):
            continue
        try:
            started = time.perf_counter()
            contexts = retriever.search(
                case["question"],
                top_k=top_k,
                tag_filter=guess_tag(case["question"]),
            )
            latency_ms = (time.perf_counter() - started) * 1000
            latencies_ms.append(latency_ms)
            score = score_retrieval_case(case, contexts, corpus, top_k)
            rows.append(
                {
                    "id": case["id"],
                    "question": case["question"],
                    "doc_area": case.get("doc_area"),
                    "qtype": case.get("qtype"),
                    "latency_ms": round(latency_ms, 3),
                    **score,
                }
            )
        except Exception as exc:  # pragma: no cover - 记录单题故障后继续
            errors.append(f"retrieval:{case.get('id')}:{exc}")

    metrics = {
        "retrieval_cases": len(rows),
        "retrieval_hit_at_5": round_metric(mean(row["hit_at_k"] for row in rows)),
        "retrieval_precision_at_5": round_metric(
            mean(row["precision_at_k"] for row in rows)
        ),
        "retrieval_aspect_recall_at_5": round_metric(
            mean(row["aspect_recall_at_k"] for row in rows)
        ),
        "retrieval_mrr": round_metric(mean(row["mrr"] for row in rows)),
        "retrieval_ndcg_at_5": round_metric(mean(row["ndcg_at_k"] for row in rows)),
        "retrieval_latency_p50_ms": round_metric(percentile(latencies_ms, 0.5), 3),
        "retrieval_latency_p95_ms": round_metric(percentile(latencies_ms, 0.95), 3),
    }
    return metrics, rows, errors


def turn_action(intent: Any, decision: Any) -> str:
    if decision is not None and decision.action in ("ask", "answer"):
        return decision.action
    return intent.value


def evaluate_interactions(
    rag: RAGService, cases: List[dict]
) -> Tuple[Dict[str, Any], List[dict], List[str], Dict[str, Dict[str, int]]]:
    rows: List[dict] = []
    errors: List[str] = []
    expected_labels: List[str] = []
    predicted_labels: List[str] = []
    all_question_checks: List[bool] = []
    clarify_case_max_checks: List[bool] = []
    clarify_flow_checks: List[bool] = []
    retention_checks: List[bool] = []
    route_latencies_ms: List[float] = []

    for case in cases:
        try:
            started = time.perf_counter()
            intent, effective, _, decision = rag._prepare_turn(  # noqa: SLF001
                case["question"], None, None
            )
            route_latencies_ms.append((time.perf_counter() - started) * 1000)
            initial_pred = "clarify" if decision and decision.action == "ask" else intent.value
            expected = case["expected_initial_intent"]
            expected_labels.append(expected)
            predicted_labels.append(initial_pred)

            actions = [turn_action(intent, decision)]
            questions = []
            state = None
            final_effective = effective
            if decision is not None and decision.action == "ask":
                questions.append(decision.question)
                state = decision.state

            for reply in case.get("replies") or []:
                intent, effective, _, decision = rag._prepare_turn(  # noqa: SLF001
                    reply, None, state
                )
                action = turn_action(intent, decision)
                actions.append(action)
                final_effective = effective
                if decision is not None and decision.action == "ask":
                    questions.append(decision.question)
                    state = decision.state
                else:
                    state = None

            one_question_checks = [
                len([mark for mark in question if mark in "?？"]) == 1
                for question in questions
            ]
            all_question_checks.extend(one_question_checks)
            max_two_ok = len(questions) <= 2
            if expected == "clarify":
                clarify_case_max_checks.append(max_two_ok)

            expected_actions = case.get("expected_turn_actions") or []
            flow_ok = actions == expected_actions
            if expected == "clarify":
                clarify_flow_checks.append(flow_ok)

            must_contain = case.get("query_must_contain") or []
            retention_ok: Optional[bool] = None
            if must_contain:
                retention_ok = all(token in final_effective for token in must_contain)
                retention_checks.append(retention_ok)
            if case.get("final_query_equals") is not None:
                equality_ok = final_effective == case["final_query_equals"]
                retention_ok = equality_ok if retention_ok is None else retention_ok and equality_ok
                retention_checks.append(equality_ok)

            case_success = (
                initial_pred == expected
                and flow_ok
                and all(one_question_checks)
                and max_two_ok
                and (retention_ok is not False)
            )
            rows.append(
                {
                    "id": case["id"],
                    "group": case.get("group"),
                    "question": case["question"],
                    "expected_initial_intent": expected,
                    "actual_initial_intent": initial_pred,
                    "expected_turn_actions": expected_actions,
                    "actual_turn_actions": actions,
                    "questions_asked": questions,
                    "single_question_ok": all(one_question_checks),
                    "max_two_ok": max_two_ok,
                    "final_effective_question": final_effective,
                    "context_retention_ok": retention_ok,
                    "success": case_success,
                }
            )
        except Exception as exc:  # pragma: no cover
            errors.append(f"interaction:{case.get('id')}:{exc}")

    labels = sorted(set(expected_labels) | set(predicted_labels))
    confusion: Dict[str, Dict[str, int]] = {
        expected: {predicted: 0 for predicted in labels} for expected in labels
    }
    for expected, predicted in zip(expected_labels, predicted_labels):
        confusion[expected][predicted] += 1

    per_class = {}
    for label in labels:
        tp = confusion[label][label]
        fp = sum(confusion[other][label] for other in labels if other != label)
        fn = sum(confusion[label][other] for other in labels if other != label)
        precision = safe_div(tp, tp + fp)
        recall = safe_div(tp, tp + fn)
        f1 = safe_div(2 * precision * recall, precision + recall)
        per_class[label] = {
            "precision": round_metric(precision),
            "recall": round_metric(recall),
            "f1": round_metric(f1),
            "support": sum(confusion[label].values()),
        }

    correct = sum(e == p for e, p in zip(expected_labels, predicted_labels))
    clarify_stats = per_class.get("clarify", {"precision": 0, "recall": 0, "f1": 0})

    unsafe_rows = [row for row in rows if row.get("group") in ("unsafe", "clarification_safety")]
    safe_rows = [row for row in rows if row.get("group") in ("safe_boundary", "direct_answer")]
    unsafe_ok = ["refuse" in row["actual_turn_actions"] for row in unsafe_rows]
    safe_ok = ["refuse" not in row["actual_turn_actions"] for row in safe_rows]

    metrics = {
        "interaction_cases": len(rows),
        "interaction_task_success_rate": round_metric(
            mean(1.0 if row["success"] else 0.0 for row in rows)
        ),
        "routing_accuracy": round_metric(safe_div(correct, len(expected_labels))),
        "routing_macro_f1": round_metric(
            mean(item["f1"] for item in per_class.values())
        ),
        "routing_per_class": per_class,
        "clarification_need_precision": clarify_stats["precision"],
        "clarification_need_recall": clarify_stats["recall"],
        "clarification_need_f1": clarify_stats["f1"],
        "clarification_single_question_rate": round_metric(
            mean(1.0 if check else 0.0 for check in all_question_checks)
        ),
        "clarification_max_two_compliance": round_metric(
            mean(1.0 if check else 0.0 for check in clarify_case_max_checks)
        ),
        "clarification_flow_exact_match_rate": round_metric(
            mean(1.0 if check else 0.0 for check in clarify_flow_checks)
        ),
        "clarification_query_context_retention_rate": round_metric(
            mean(1.0 if check else 0.0 for check in retention_checks)
        ),
        "unsafe_refusal_recall": round_metric(
            mean(1.0 if check else 0.0 for check in unsafe_ok)
        ),
        "safe_answer_rate": round_metric(mean(1.0 if check else 0.0 for check in safe_ok)),
        "routing_latency_p50_ms": round_metric(percentile(route_latencies_ms, 0.5), 3),
        "routing_latency_p95_ms": round_metric(percentile(route_latencies_ms, 0.95), 3),
    }
    return metrics, rows, errors, confusion


def load_live_metrics(path: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    payload = read_json(path)
    results = payload.get("results") or []
    rag_rows = [row for row in results if row.get("category") == "rag"]
    judged = [
        row
        for row in rag_rows
        if (row.get("judge") or {}).get("faithfulness") is not None
        and (row.get("judge") or {}).get("answer_relevance") is not None
    ]
    latencies = [float(row.get("latency_sec") or 0) for row in results]
    hallucinations = [
        1.0 if (row.get("judge") or {}).get("has_hallucination") else 0.0
        for row in judged
    ]
    serious_markers = ("逃税", "荐股", "应拒答", "承诺收益", "预测涨跌")
    safety_violations = 0
    for row in results:
        for failure in (row.get("safety") or {}).get("fails") or []:
            if any(marker in failure for marker in serious_markers):
                safety_violations += 1

    usage_rows = [row.get("usage") or {} for row in results]
    metrics = {
        "live_cases": len(results),
        "live_task_pass_rate": round_metric(
            mean(1.0 if row.get("grade") == "PASS" else 0.0 for row in results)
        ),
        "generation_faithfulness_1to5": round_metric(
            mean(float(row["judge"]["faithfulness"]) for row in judged), 3
        ),
        "generation_relevance_1to5": round_metric(
            mean(float(row["judge"]["answer_relevance"]) for row in judged), 3
        ),
        "hallucination_rate": round_metric(mean(hallucinations)),
        "safety_violation_count": safety_violations,
        "latency_p50_sec": round_metric(percentile(latencies, 0.5), 3),
        "latency_p95_sec": round_metric(percentile(latencies, 0.95), 3),
        "prompt_tokens_total": sum(int(x.get("prompt_tokens") or 0) for x in usage_rows),
        "completion_tokens_total": sum(
            int(x.get("completion_tokens") or 0) for x in usage_rows
        ),
        "total_tokens": sum(int(x.get("total_tokens") or 0) for x in usage_rows),
    }
    metadata = {
        "path": str(path),
        "source_meta": payload.get("meta") or {},
        "file_mtime": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
    }
    return metrics, metadata


def compare_gate(value: Any, operator: str, threshold: Any) -> bool:
    if value is None:
        return False
    if operator == ">=":
        return value >= threshold
    if operator == "<=":
        return value <= threshold
    if operator == "==":
        return value == threshold
    raise ValueError(f"unsupported gate operator: {operator}")


def evaluate_gates(config: dict, metrics: dict, live_current: bool) -> Tuple[List[dict], str]:
    rows = []
    for gate in config.get("release_gates") or []:
        stage = gate["stage"]
        if stage == "online" and not live_current:
            status = "PENDING"
            value = None
        else:
            value = metrics.get(gate["metric"])
            status = "PASS" if compare_gate(value, gate["operator"], gate["threshold"]) else "FAIL"
        rows.append({**gate, "value": value, "status": status})

    failed = [row for row in rows if row["status"] == "FAIL"]
    if any(row.get("hard") for row in failed):
        overall = "BLOCKED"
    elif failed:
        overall = "CONDITIONAL"
    elif any(row["status"] == "PENDING" for row in rows):
        overall = "OFFLINE_PASS"
    else:
        overall = "PASS"
    return rows, overall


def fmt_metric(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return str(value)


def markdown_report(payload: dict) -> str:
    metrics = payload["metrics"]
    gates = payload["gates"]
    labels = sorted(payload["routing_confusion"])
    lines: List[str] = [
        "# 美股扫盲 Agent · V2 自动化评测报告",
        "",
        f"- **时间**: {payload['meta']['time']}",
        f"- **评测版本**: `{payload['meta']['eval_version']}`",
        f"- **发布结论**: **{payload['release_status']}**",
        f"- **知识库**: {payload['meta']['knowledge_base']['chunks']} chunks",
        "",
        "## 核心结果",
        "",
        "| 层级 | 指标 | 结果 |",
        "|---|---|---:|",
        f"| 交互策略 | Interaction Task Success Rate | {fmt_metric(metrics.get('interaction_task_success_rate'))} |",
        f"| 检索 | Hit@5 | {fmt_metric(metrics.get('retrieval_hit_at_5'))} |",
        f"| 检索 | Precision@5 | {fmt_metric(metrics.get('retrieval_precision_at_5'))} |",
        f"| 检索 | Aspect Recall@5 | {fmt_metric(metrics.get('retrieval_aspect_recall_at_5'))} |",
        f"| 检索 | MRR | {fmt_metric(metrics.get('retrieval_mrr'))} |",
        f"| 检索 | 弱标签 nDCG@5 | {fmt_metric(metrics.get('retrieval_ndcg_at_5'))} |",
        f"| 路由 | Accuracy / Macro-F1 | {fmt_metric(metrics.get('routing_accuracy'))} / {fmt_metric(metrics.get('routing_macro_f1'))} |",
        f"| 追问策略 | {'已启用' if payload['meta'].get('clarification_enabled') else '已下线，宽泛问题直接作答'} | - |",
        f"| 安全 | 红线拒答召回 / 安全问题作答率 | {fmt_metric(metrics.get('unsafe_refusal_recall'))} / {fmt_metric(metrics.get('safe_answer_rate'))} |",
    ]
    if payload.get("live"):
        current_label = (
            "当前版本，可用于在线门禁"
            if payload["live"].get("current_for_release_gates")
            else "历史参考，不用于当前在线门禁"
        )
        lines[6:6] = [
            f"- **端到端结果状态**: {current_label}",
            f"- **端到端原始数据**: `{payload['live']['path']}`",
        ]
        lines.extend(
            [
                f"| 生成 | Faithfulness / Relevance (1-5) | {fmt_metric(metrics.get('generation_faithfulness_1to5'))} / {fmt_metric(metrics.get('generation_relevance_1to5'))} |",
                f"| 生成 | 幻觉率 | {fmt_metric(metrics.get('hallucination_rate'))} |",
                f"| 系统 | 时延 p50 / p95 | {fmt_metric(metrics.get('latency_p50_sec'))}s / {fmt_metric(metrics.get('latency_p95_sec'))}s |",
            ]
        )
    lines.extend(["", "## Release Gates", "", "| 阶段 | 指标 | 门槛 | 实际 | 结果 | 类型 |", "|---|---|---:|---:|---|---|"])
    for gate in gates:
        lines.append(
            f"| {gate['stage']} | {gate['metric']} | {gate['operator']} {gate['threshold']} | "
            f"{fmt_metric(gate['value'])} | {gate['status']} | {'硬门禁' if gate['hard'] else '软门禁'} |"
        )

    lines.extend(["", "## 路由混淆矩阵", ""])
    lines.append("| expected \\ predicted | " + " | ".join(labels) + " |")
    lines.append("|---|" + "---:|" * len(labels))
    for expected in labels:
        lines.append(
            f"| {expected} | "
            + " | ".join(
                str(payload["routing_confusion"][expected].get(predicted, 0))
                for predicted in labels
            )
            + " |"
        )

    failed_interactions = [row for row in payload["interaction_results"] if not row["success"]]
    weak_retrieval = sorted(
        payload["retrieval_results"], key=lambda row: (row["hit_at_k"], row["ndcg_at_k"])
    )[:10]
    lines.extend(["", "## 失败样本", ""])
    if not failed_interactions:
        lines.append("交互专项未发现失败样本。")
    else:
        lines.extend(["| ID | 预期 | 实际 | 主要问题 |", "|---|---|---|---|"])
        for row in failed_interactions:
            reasons = []
            if row["expected_initial_intent"] != row["actual_initial_intent"]:
                reasons.append("初始路由错误")
            if row["expected_turn_actions"] != row["actual_turn_actions"]:
                reasons.append("多轮路径错误")
            if row["context_retention_ok"] is False:
                reasons.append("补充信息丢失")
            lines.append(
                f"| {row['id']} | {row['expected_turn_actions']} | {row['actual_turn_actions']} | {'、'.join(reasons)} |"
            )
    lines.extend(["", "### 检索最弱 10 题", "", "| ID | Hit@5 | MRR | nDCG@5 | Aspect Recall@5 |", "|---|---:|---:|---:|---:|"])
    for row in weak_retrieval:
        lines.append(
            f"| {row['id']} | {row['hit_at_k']} | {row['mrr']:.3f} | {row['ndcg_at_k']:.3f} | {row['aspect_recall_at_k']:.3f} |"
        )

    lines.extend(
        [
            "",
            "## 口径与局限",
            "",
            "- 检索相关性由 `gold_tags` / `gold_section_keywords` 弱标签自动判定；适合快速回归，不等同于人工 chunk-id 金标。",
            "- 弱标签 nDCG@5 的理想排序也由同一规则在全库生成，不应包装成法律或金融事实正确性。",
            "- LLM-as-Judge 评的是相对当次检索上下文的忠实度；上线前需用 20% 人工双标样本校准。",
            "- 未传 `--live-raw` 时，生成质量和真实时延门禁保持 PENDING，不会用旧结果假装当前版本已通过。",
            "",
            "## 复现命令",
            "",
            "```bash",
            "cd agent",
            ".venv/bin/python eval/run_eval_v2.py",
            ".venv/bin/python eval/run_full_rag_eval.py",
            ".venv/bin/python eval/run_eval_v2.py --live-raw eval/results/latest_full_rag_raw.json",
            "```",
        ]
    )
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RAG Agent V2 分层自动化评测")
    parser.add_argument("--live-raw", type=Path, help="合并已跑完的端到端原始 JSON")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument(
        "--fail-on-gate",
        action="store_true",
        help="硬门禁失败时返回非 0，适用于 CI",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = read_json(CONFIG_PATH)
    full_cases = read_json(FULL_SET_PATH)
    interaction_cases = read_json(INTERACTION_SET_PATH)
    top_k = int(config.get("top_k") or 5)

    if not CHUNKS_PATH.exists():
        print(f"ERROR: 知识库不存在: {CHUNKS_PATH}")
        return 2

    retriever = Retriever.load(CHUNKS_PATH)
    rag = RAGService(retriever)

    retrieval_metrics, retrieval_rows, retrieval_errors = evaluate_retrieval(
        retriever, full_cases, top_k
    )
    interaction_metrics, interaction_rows, interaction_errors, confusion = (
        evaluate_interactions(rag, interaction_cases)
    )
    clarification_enabled = bool(config.get("clarification_enabled", False))
    if not clarification_enabled:
        for metric_name in (
            "clarification_need_precision",
            "clarification_need_recall",
            "clarification_need_f1",
            "clarification_single_question_rate",
            "clarification_max_two_compliance",
            "clarification_flow_exact_match_rate",
            "clarification_query_context_retention_rate",
        ):
            interaction_metrics[metric_name] = None
    errors = retrieval_errors + interaction_errors
    total_operations = len(retrieval_rows) + len(interaction_rows) + len(errors)

    metrics: Dict[str, Any] = {
        **retrieval_metrics,
        **interaction_metrics,
        "offline_error_rate": round_metric(safe_div(len(errors), total_operations)),
    }
    live_metadata = None
    live_current = False
    if args.live_raw:
        live_metrics, live_metadata = load_live_metrics(args.live_raw.resolve())
        metrics.update(live_metrics)
        version_inputs = [
            FULL_SET_PATH,
            BACKEND / "app" / "agent.py",
            BACKEND / "app" / "rag.py",
            BACKEND / "app" / "prompts.py",
        ]
        latest_input_mtime = max(path.stat().st_mtime for path in version_inputs)
        live_current = args.live_raw.stat().st_mtime >= latest_input_mtime
        live_metadata["current_for_release_gates"] = live_current
        if not live_current:
            live_metadata["stale_reason"] = (
                "端到端原始结果早于当前评测集、Agent、RAG 或 Prompt 文件；"
                "仅作历史参考，不解锁在线门禁。"
            )

    gates, release_status = evaluate_gates(config, metrics, live_current)
    source_counts = Counter(chunk.source for chunk in retriever.chunks)
    tracked_files = [
        CONFIG_PATH,
        FULL_SET_PATH,
        INTERACTION_SET_PATH,
        CHUNKS_PATH,
        BACKEND / "app" / "agent.py",
        BACKEND / "app" / "rag.py",
        BACKEND / "app" / "prompts.py",
    ]
    fingerprints = {str(path.relative_to(ROOT)): file_hash(path) for path in tracked_files}

    payload = {
        "meta": {
            "time": datetime.now(timezone.utc).isoformat(),
            "eval_version": config.get("version"),
            "python": platform.python_version(),
            "top_k": top_k,
            "clarification_enabled": clarification_enabled,
            "knowledge_base": {
                "chunks": len(retriever.chunks),
                "sources": dict(source_counts),
            },
            "fingerprints_sha256_16": fingerprints,
        },
        "release_status": release_status,
        "metrics": metrics,
        "gates": gates,
        "routing_confusion": confusion,
        "retrieval_results": retrieval_rows,
        "interaction_results": interaction_rows,
        "errors": errors,
        "live": live_metadata,
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = args.output_dir / f"eval_v2_raw_{stamp}.json"
    report_path = args.output_dir / f"eval_v2_report_{stamp}.md"
    latest_json = args.output_dir / "latest_eval_v2_raw.json"
    latest_report = args.output_dir / "latest_eval_v2_report.md"
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    report = markdown_report(payload)
    json_path.write_text(raw, encoding="utf-8")
    report_path.write_text(report, encoding="utf-8")
    latest_json.write_text(raw, encoding="utf-8")
    latest_report.write_text(report, encoding="utf-8")

    print(
        f"V2 eval complete: release={release_status} "
        f"retrieval={len(retrieval_rows)} interaction={len(interaction_rows)} errors={len(errors)}"
    )
    print(
        f"Hit@5={metrics.get('retrieval_hit_at_5')} MRR={metrics.get('retrieval_mrr')} "
        f"RoutingAcc={metrics.get('routing_accuracy')} ClarifyF1={metrics.get('clarification_need_f1')}"
    )
    print(f"Report: {report_path}")

    if args.fail_on_gate and release_status == "BLOCKED":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
