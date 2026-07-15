# Agent 接入网站说明

网站右下角「扫盲助手」通过 Next.js `/api/chat` **代理**到本目录下的 Python FastAPI RAG Agent。

## 架构

```
浏览器抽屉 UI
  → POST /api/chat  (Next.js)
    → AGENT_URL/api/chat  (Python FastAPI, 默认 :8001)
      → 意图路由 / BM25 检索 / DeepSeek 生成
    → 失败时回退 lib/rag/mock.ts
```

## 本地启动

### 1. 配置 Agent 密钥

```bash
cd agent
cp .env.example .env
# 编辑 .env，填写 DEEPSEEK_API_KEY
```

### 2. 安装并启动 Agent

```bash
# 在网站根目录
npm run agent:install   # 首次
npm run agent:dev       # 默认 http://127.0.0.1:8001
```

### 3. 启动网站

```bash
# 网站根目录 .env.local 可选：
# AGENT_URL=http://127.0.0.1:8001

npm run dev
```

打开首页右下角「扫盲助手」即可对话。

## 健康检查

- Agent: `http://127.0.0.1:8001/api/health`
- 若 Agent 未启动，抽屉仍可聊，但会走 mock 并提示回退

## 重新构建知识库

知识库 = PDF《中国人投资美股指南》+ 网站 `content/posts/*.md` 站内教程。

```bash
# 在网站根目录
npm run agent:reindex
# 改完帖子或 PDF 后需重启 agent 服务以重新加载 chunks
npm run agent:dev
```

- PDF：`agent/data/中国人投资美股指南.pdf`
- 站内帖：`content/posts/`（自动切块，引用可跳转 `/posts/{slug}`）
