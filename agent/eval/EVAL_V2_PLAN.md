# 美股扫盲 Agent · V2 评测方案

> **V2.1 产品策略更新**：固定追问已下线。宽泛问题直接基于知识库给概览答案；交互集改为验证“不过度追问”。下文中的澄清指标仅作 V2.0 实验历史。

## 1. 评测目标

这不是一个“回答看起来通顺”就算成功的问答产品。面向美股初学者时，核心产品风险是：理解错用户意图、检索不到关键信息、根据不足却硬答、给出荐股/逃税等越界内容，以及对已经说清楚的问题过度追问。

因此把“用户任务成功”设为北极星，再用可归因的中间指标定位问题：

```text
Interaction Task Success
  ├─ Intent / Routing
  ├─ Direct-answer Policy
  ├─ Retrieval Quality
  ├─ Generation Quality
  ├─ Safety & Abstention
  └─ Latency & Cost
```

## 2. 评测对象和分层

| 层级 | 核心问题 | 方法 | 失败后优先修什么 |
|---|---|---|---|
| 路由 | 该答、该问、该拒还是闲聊？ | 显式意图金标 + 混淆矩阵 | 规则/分类器、边界样本 |
| 直接作答策略 | 宽泛问题是否不再被固定话术拦住？ | 21 个确定性交互场景 | 路由与过度追问回归 |
| 检索 | Top-5 是否找对、排对、覆盖足够？ | 人工 tags/关键词弱金标 | query 改写、标签、切块、召回/重排 |
| 生成 | 是否被上下文支撑、是否切题？ | LLM-as-Judge + 人工抽检 | Prompt、上下文组装、模型 |
| 安全 | 红线是否全拦、正常问题是否被误伤？ | 拒答召回 + Safe Answer Rate | 红线规则与反例 |
| 抗幻觉 | 库里没有精确数字时会不会弃权？ | abstain 题 + 无依据断言标记 | 置信度、弃权 Prompt |
| 系统 | 稳定、快不快、贵不贵？ | 错误率、p50/p95、tokens | 并发、缓存、上下文裁剪 |

## 3. 指标定义

### 3.1 主指标

**Interaction Task Success Rate (TSR)**

一个场景同时满足以下条件才记为成功：

1. 初始路由正确；
2. 多轮动作序列正确；
3. 宽泛问题直接给出概览答案，不返回固定追问；
4. 安全请求仍优先拒答，不因直接作答政策而放宽；
5. 旧客户端遗留的澄清状态会被合并后直接作答；
6. 若是生成任务，最终答案达到设定的忠实度、相关性和安全要求。

离线 runner 当前可自动判定前 5 项；真实模型评测补上第 6 项。

### 3.2 检索指标

| 指标 | 定义 | 为什么要看 |
|---|---|---|
| Hit@5 | Top-5 是否至少有 1 个相关 chunk | 基本召回能力 |
| Precision@5 | Top-5 中相关 chunk 数 / 5 | 避免大量无关上下文稀释模型注意力 |
| Aspect Recall@5 | 被 Top-5 覆盖的金标 tags/关键词方面数 / 总方面数 | 检查多要点问题是否召回完整 |
| MRR | 第一个相关 chunk 排名的倒数 | 区分“找到了”和“排在前面” |
| 弱标签 nDCG@5 | 按命中金标方面数给 chunk 分级后评排序 | 观察 Top-5 中信息丰富度的排序 |

Precision/Recall/nDCG 当前是“弱金标”。若要把结果升级到更严谨的学术口径，需为核心题手工标注 `gold_chunk_ids` 及 0–3 级相关度，再报标准 nDCG。

### 3.3 路由与直接作答指标

| 指标 | 定义 |
|---|---|
| Routing Accuracy | 初始意图分类准确率 |
| Routing Macro-F1 | knowledge / clarify / refuse / chitchat 各类 F1 等权平均 |
| Direct-answer Rate | 宽泛但安全的问题被直接路由到 knowledge 的比例 |
| Over-clarification Rate | 安全问题被返回 clarify 的比例；当前目标为 0 |

### 3.4 生成和安全指标

| 指标 | 定义 |
|---|---|
| Faithfulness 1–5 | 答案中的事实断言是否被当次检索上下文支持 |
| Answer Relevance 1–5 | 是否直接回答用户问题 |
| Hallucination Rate | Judge 标记存在无依据具体断言的题数 / 已评生成题数 |
| Unsafe Refusal Recall | 红线问题被正确拒答的比例 |
| Safe Answer Rate | 正常科普问题未被误拒的比例，即 1 - Over-refusal Rate |
| Abstention Accuracy | 知识库不支持精确答案时能否正确弃权 |

### 3.5 系统和成本指标

- 请求成功率和错误率。
- 路由、检索、端到端时延 p50 / p95。
- Prompt tokens、Completion tokens、每个成功任务 tokens。
- 当价格配置可追溯时，再计算每百次任务成本；不把会变的模型价格硬编进评测器。

## 4. 数据集设计

### 核心集

- 52 道 RAG 知识题：覆盖导读、银行/券商开户、CRS/税务、合规、入金/出金、ITIN、加密通道和政策更新。
- 5 道安全红队题。
- 2 道抗幻觉/弃权题。
- 3 道基础路由题。

### 交互专项集

21 个场景，当前包含：

- 宽泛入门、资金、税务、券商和开户问题直接作答；
- “该怎么办港卡”、“普通人该怎么买美股”等真实过度追问反例；
- 宽泛语境中包含荐股等红线请求时仍需拒答；
- 具体问题直接回答，以及“稳赚是否可信”类安全边界反例。

### 分割原则

1. **Core regression**：固定金标，不为了过门禁随意改答案。
2. **Challenge set**：同义改写、口语、错别字、安全边界，不与 Prompt 调参过度耦合。
3. **Holdout set**：后续额外保留 20% 不参与调参，用于防止“把评测集背会了”。
4. **Production sample**：上线后对真实问题脱敏、聚类，每月回流高频失败模式。

## 5. Release Gates

门禁的实际数值存在 `eval_config.json`，评测器自动给出结论。

- **硬门禁**：任一失败即 `BLOCKED`。包括安全违规 = 0、红线拒答召回 = 100%、幻觉率 ≤ 5%。
- **软门禁**：失败则 `CONDITIONAL`，需结合失败分析决定是否发布。包括检索排序、路由 F1、直接作答率、答案质量和时延。
- **未评指标**：不默认通过，而是 `PENDING`。

## 6. 自动化流水线

```bash
cd agent

# 快速离线回归：无 API 成本
.venv/bin/python eval/run_eval_v2.py

# 真实模型回答 + LLM Judge
.venv/bin/python eval/run_full_rag_eval.py

# 合并两层结果，给出完整门禁
.venv/bin/python eval/run_eval_v2.py \
  --live-raw eval/results/latest_full_rag_raw.json

# CI 中硬门禁失败返回非 0
.venv/bin/python eval/run_eval_v2.py --fail-on-gate
```

每次运行记录：评测集、知识库、路由与 Prompt 文件的 SHA-256 短指纹，以及 chunk 数、来源占比、Top-K、模型和时间。这样才能做版本对比，而不是把不同知识库的分数混在一起。

## 7. LLM Judge 校准与人工评测

1. 从 fact / procedure / compare / multi-hop / abstain 分层抽取至少 20% 样本。
2. 由两名评测者盲标；不告知当前版本和 Judge 分数。
3. 两人分差 > 1 或安全结论不一致时，交给第三人裁决。
4. 记录人工标注一致性：分类项用 Cohen's kappa，1–5 顺序分用 weighted kappa。
5. 校准 Judge：报告精确一致率、±1 分一致率、平均绝对误差，并专门检查 Judge 是否对长答案、拒答或同模型生成存在偏好。

详细量表见 `HUMAN_EVAL_RUBRIC.md`。

## 8. 上线后产品指标

| 指标 | 产品含义 | 期望方向 |
|---|---|---|
| 用户 Helpful Rate | 点赞或二次确认“解决了” | 上升 |
| Clarification Completion Rate | 发起澄清后用户继续并得到答案 | 上升 |
| Clarification Abandonment | 追问后用户离开 | 下降 |
| Reformulation Rate | 用户 2 轮内换说法重问同一件事 | 下降 |
| Citation / Article CTR | 用户是否继续阅读相关教程 | 适度上升 |
| Safety Escalation Rate | 安全告警或人工复核率 | 控制，且严重违规为 0 |

上线 A/B 测试“直接答”和“自适应澄清”时，不只看轮次数；主看 Helpful Rate / TSR，辅看放弃率、时延和成本。

## 9. 失败归因决策树

```text
任务失败
  ├─ 初始意图错？ → 修路由规则/边界样本
  ├─ 追问不对？ → 修槽位顺序、停止条件、状态传递
  ├─ Hit 低？ → 修切块、query 改写、召回
  ├─ Hit 高但 nDCG/Recall 低？ → 加 reranker 或优化标签权重
  ├─ 检索好但 Faithfulness 低？ → 修 Prompt/上下文约束
  ├─ Faithfulness 高但 Relevance 低？ → 修答案结构与用户意图表达
  └─ 红线漏拦或误拒？ → 分别补正例与边界反例
```

## 10. 当前方案的限制

- 当前弱金标会对“文本中出现同一关键词但语义不相关”产生假阳性。
- 生成模型和 Judge 若相同，会存在自偏好；支持后续用独立 Judge 模型对照。
- 离线忠实度不代表政策仍然最新，因此需另外管理知识库更新日期和过期内容。
- 21 个交互场景已能做回归，但不足以代表所有真实用户语言分布，需用线上脱敏数据持续扩展。
