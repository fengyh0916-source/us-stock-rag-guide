# 美股扫盲 Agent · V2 自动化评测报告

- **时间**: 2026-07-15T02:21:47.424982+00:00
- **评测版本**: `2.1.0`
- **发布结论**: **CONDITIONAL**
- **知识库**: 349 chunks
- **端到端结果状态**: 历史参考，不用于当前在线门禁
- **端到端原始数据**: `/Users/fengyihang/Documents/美股扫盲网站/agent/eval/results/latest_full_rag_raw.json`

## 核心结果

| 层级 | 指标 | 结果 |
|---|---|---:|
| 交互策略 | Interaction Task Success Rate | 1 |
| 检索 | Hit@5 | 1 |
| 检索 | Precision@5 | 0.9923 |
| 检索 | Aspect Recall@5 | 0.9226 |
| 检索 | MRR | 0.9904 |
| 检索 | 弱标签 nDCG@5 | 0.6212 |
| 路由 | Accuracy / Macro-F1 | 1 / 1 |
| 追问策略 | 已下线，宽泛问题直接作答 | - |
| 安全 | 红线拒答召回 / 安全问题作答率 | 1 / 1 |
| 生成 | Faithfulness / Relevance (1-5) | 4.808 / 4.981 |
| 生成 | 幻觉率 | 0.0192 |
| 系统 | 时延 p50 / p95 | 4.035s / 6.735s |

## Release Gates

| 阶段 | 指标 | 门槛 | 实际 | 结果 | 类型 |
|---|---|---:|---:|---|---|
| offline | retrieval_hit_at_5 | >= 0.9 | 1 | PASS | 软门禁 |
| offline | retrieval_mrr | >= 0.75 | 0.9904 | PASS | 软门禁 |
| offline | retrieval_ndcg_at_5 | >= 0.75 | 0.6212 | FAIL | 软门禁 |
| offline | retrieval_aspect_recall_at_5 | >= 0.55 | 0.9226 | PASS | 软门禁 |
| offline | routing_accuracy | >= 0.9 | 1 | PASS | 软门禁 |
| offline | routing_macro_f1 | >= 0.85 | 1 | PASS | 软门禁 |
| offline | unsafe_refusal_recall | == 1.0 | 1 | PASS | 硬门禁 |
| offline | safe_answer_rate | >= 0.9 | 1 | PASS | 软门禁 |
| offline | offline_error_rate | <= 0.02 | 0 | PASS | 硬门禁 |
| online | generation_faithfulness_1to5 | >= 4.2 | - | PENDING | 软门禁 |
| online | generation_relevance_1to5 | >= 4.3 | - | PENDING | 软门禁 |
| online | hallucination_rate | <= 0.05 | - | PENDING | 硬门禁 |
| online | live_task_pass_rate | >= 0.85 | - | PENDING | 软门禁 |
| online | safety_violation_count | == 0 | - | PENDING | 硬门禁 |
| online | latency_p95_sec | <= 20.0 | - | PENDING | 软门禁 |

## 路由混淆矩阵

| expected \ predicted | chitchat | knowledge | refuse |
|---|---:|---:|---:|
| chitchat | 1 | 0 | 0 |
| knowledge | 0 | 16 | 0 |
| refuse | 0 | 0 | 4 |

## 失败样本

交互专项未发现失败样本。

### 检索最弱 10 题

| ID | Hit@5 | MRR | nDCG@5 | Aspect Recall@5 |
|---|---:|---:|---:|---:|
| S02 | 1 | 0.500 | 0.067 | 0.571 |
| S41 | 1 | 1.000 | 0.154 | 0.875 |
| S18 | 1 | 1.000 | 0.172 | 0.400 |
| S03 | 1 | 1.000 | 0.177 | 0.750 |
| S10 | 1 | 1.000 | 0.178 | 0.750 |
| S17 | 1 | 1.000 | 0.205 | 0.714 |
| S32 | 1 | 1.000 | 0.299 | 0.667 |
| S25 | 1 | 1.000 | 0.320 | 0.833 |
| S01 | 1 | 1.000 | 0.343 | 1.000 |
| S08 | 1 | 1.000 | 0.367 | 1.000 |

## 口径与局限

- 检索相关性由 `gold_tags` / `gold_section_keywords` 弱标签自动判定；适合快速回归，不等同于人工 chunk-id 金标。
- 弱标签 nDCG@5 的理想排序也由同一规则在全库生成，不应包装成法律或金融事实正确性。
- LLM-as-Judge 评的是相对当次检索上下文的忠实度；上线前需用 20% 人工双标样本校准。
- 未传 `--live-raw` 时，生成质量和真实时延门禁保持 PENDING，不会用旧结果假装当前版本已通过。

## 复现命令

```bash
cd agent
.venv/bin/python eval/run_eval_v2.py
.venv/bin/python eval/run_full_rag_eval.py
.venv/bin/python eval/run_eval_v2.py --live-raw eval/results/latest_full_rag_raw.json
```
