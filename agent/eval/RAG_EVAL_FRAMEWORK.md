# RAG 完整评测体系（面试可讲版）

本项目评测对齐业界常见的 **RAG 分层评测**：先测「找得对不对」，再测「答得忠不忠、贴不贴题」，再加上 **产品安全与格式**。

## 1. 为什么要分层？

| 环节 | 出问题的表现 | 只测「回答好不好」会怎样 |
|------|----------------|---------------------------|
| 检索 Retrieval | 找错章节，答案再流畅也偏 | 误以为模型不行 |
| 生成 Generation | 有对的材料却胡编/漏答 | 误以为检索不行 |
| 安全 / 产品 | 荐股、逃税、乱引用 | 工程风险 |

面试官常问：「你怎么证明 RAG 有效？」标准答法是：

> 我拆成 Retrieval / Faithfulness / Answer Relevance / Safety，分别打分，而不是只看体感。

## 2. 本体系测什么？

### A. 检索质量（Retrieval）

- **Hit@K**：Top-K 结果里是否命中标注的「应查章节/标签/关键词」
- **标签覆盖**：`tags`（税务/券商/入金…）是否命中金标
- **章节/小节关键词**：section/chapter/text 是否含金标词
- **空检索率**：该走 RAG 时是否检索为空

金标来自评测集人工标注（对照《中国人投资美股指南》目录与主题）。

### B. 忠实度 / 准确性（Faithfulness / Groundedness）

- 在 **仅依据本次检索到的 chunk** 的前提下，回答是否被材料支撑
- 使用 **LLM-as-Judge**（结构化 JSON：1–5 分 + 是否幻觉 + 简短理由）
- 规则补充：禁用「参见章节」等产品约束；明显逃税教唆等硬失败

> 说明：忠实度衡量的是「相对检索上下文是否胡编」，不是「全网最新政策是否绝对正确」。知识库过时属于知识工程问题，需版本管理与更新。

### C. 答案相关性（Answer Relevance）

- 是否真正回答用户问题（而非跑题）
- LLM-as-Judge 1–5 分

### D. 安全与拒答（Safety）

- 荐股、逃税、造假、承诺收益、预测涨跌
- 期望意图 `refuse` 或语义拒答

### E. 路由与产品（Routing / UX）

- 意图：knowledge / clarify / refuse / guide / chitchat
- 免责声明、禁用「参考资料/文档」话术、长度等

### F. 系统指标（Systems）

- 时延 latency
- 是否调用检索 / contexts_used

## 3. 综合分怎么算？

按题型加权（见 `run_full_rag_eval.py`）：

- **RAG 知识题**：检索 30% + 忠实度 35% + 相关性 25% + 格式/安全 10%
- **安全题**：安全 80% + 路由 20%
- **引导/闲聊**：路由与体验为主，不做忠实度强约束

## 4. 如何复现

```bash
cd /path/to/美股扫盲网站/agent
source .venv/bin/activate
python eval/run_full_rag_eval.py
```

报告输出：`eval/results/full_rag_report_*.md` 与 `latest_full_rag_report.md`。

完整方案与面试叙事见 **`EVAL_PLAN.md`**。
