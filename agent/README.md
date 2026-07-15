# 美股投资扫盲 Agent

面向美股小白的**网页版科普助手**：基于《中国人投资美股指南》做 **RAG 检索问答**，并带轻量 **Agent 路由**（知识问答 / 新手引导 / 安全拒答）。

> ⚠️ **仅供科普学习，不构成任何投资、税务或法律建议。**

---

## 功能

- 中文 Chat 网页，流式输出
- 按章节切块 + BM25 中文检索 + DeepSeek 生成
- 宽泛问题直接作答：优先给出基于知识库的概览和可继续深入的方向
- 回答基于文档检索生成；正文不展示章节备注（资料不足则说明无法确认）
- 快捷问题、限流（适合公网）
- 拒答：荐股、逃税/违规操作引导

## 模型选型（性价比）

| 模型 | 用途 | 建议 |
|------|------|------|
| **`deepseek-v4-flash`** | 日常问答（默认） | **性价比首选** |
| `deepseek-v4-pro` | 更难的推理 | 一般不需要，更贵 |

说明见下文「为什么选 DeepSeek V4-Flash」。

---

## 本地运行（小白版）

### 1. 准备

- 已安装 Python 3.9+（推荐 3.11）
- 申请 [DeepSeek API Key](https://platform.deepseek.com/)

### 2. 安装依赖

```bash
cd ~/Desktop/美股投资扫盲agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 3. 配置密钥

```bash
cp .env.example .env
# 用编辑器打开 .env，填入：
# DEEPSEEK_API_KEY=sk-xxxx
```

### 4. 构建知识库

```bash
cd backend
python scripts/ingest.py
```

### 5. 启动

```bash
# 仍在 backend 目录，且已 activate venv
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

浏览器打开：<http://127.0.0.1:8001>  
（默认端口为 **8001**，避免和电脑上其它占用 8000 的项目冲突。可在 `.env` 里改 `PORT=`。）

---

## 公网部署（推荐 Railway）

1. 注册 [Railway](https://railway.app/) / [Render](https://render.com/) / [Fly.io](https://fly.io/)
2. 用 **Dockerfile** 部署本仓库（根目录已有 `Dockerfile`）
3. 配置环境变量：
   - `DEEPSEEK_API_KEY`（必填）
   - `DEEPSEEK_MODEL=deepseek-v4-flash`（可选）
   - `RATE_LIMIT_PER_MINUTE=20`（可选）
4. 生成公网域名，把链接发给别人即可使用

**注意：**

- API Key **只放在服务端环境变量**，不要写进前端代码
- 公网务必保留限流；产生的模型费用由你的 DeepSeek 账户承担
- 本项目为个人科普 Demo，上线请自行评估合规与内容风险

也可一键 Docker 本地验证：

```bash
docker build -t us-stock-agent .
docker run -p 8000:8000 -e DEEPSEEK_API_KEY=sk-xxx us-stock-agent
```

---

## 项目结构

```
美股投资扫盲agent/
├── data/
│   ├── 中国人投资美股指南.pdf
│   └── index/chunks.json      # ingest 生成
├── backend/
│   ├── app/
│   │   ├── main.py            # API + 静态页
│   │   ├── chunking.py        # PDF 切块
│   │   ├── retriever.py       # BM25 检索
│   │   ├── agent.py           # 意图路由
│   │   ├── rag.py             # RAG 生成
│   │   └── prompts.py
│   ├── scripts/ingest.py
│   └── requirements.txt
├── frontend/                  # 中文 Chat UI
├── eval/questions.json
├── Dockerfile
└── README.md
```

## 架构（一句话）

```
用户提问 → Agent 判断意图
  ├─ 宽泛问题 → 直接检索并给出概览答案
  ├─ 拒答/闲聊 → 直接回复
  └─ 知识问答 → 综合原问题与补充信息 → BM25 检索章节块 → DeepSeek 生成 → 返回答案+引用
```

---

## 为什么选 DeepSeek V4-Flash？

你的场景是：**中文科普 + 有参考资料的问答**，不是写复杂代码、也不是超难推理。

- **DeepSeek V4 系列**在 2026 年官方 API 里主要是两档：`deepseek-v4-flash` 与 `deepseek-v4-pro`
- **Flash** 价格约为 Pro 的约 1/3，延迟更低，对「根据检索片段总结」完全够用
- 挂公网后对话次数多，**Flash 的月费压力小很多**
- 因此默认模型是 **`deepseek-v4-flash`**，而不是更贵的 Pro  
  （口语里说「用 DeepSeek V4」时，作品集项目请写成 **V4-Flash**）

---

## 评测（面试可讲）

完整 RAG 评测覆盖：**检索 Hit@K、忠实度、答案相关性、安全拒答、路由/格式**。

```bash
source .venv/bin/activate
python eval/run_full_rag_eval.py
```

- 框架说明：`eval/RAG_EVAL_FRAMEWORK.md`
- **出题维度 / 题量建议（面试）**：`eval/EVAL_SET_DESIGN.md`
- 评测集（约 50 题，按指南目录覆盖）：`eval/full_eval_set.json`
- 最新报告：`eval/results/latest_full_rag_report.md`

## 免责声明

知识库来源于第三方科普文稿，仅供学习交流。政策、机构规则变化快；任何投资与税务行为后果由用户自行承担。
