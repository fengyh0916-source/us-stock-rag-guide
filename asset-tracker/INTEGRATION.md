# 个人资产管理看板 · 接入美股扫盲网站

## 架构

```
浏览器 /asset-tracker/          # 构建后的 Vite React SPA（public/asset-tracker）
  → /api/dashboard 等           # Next.js rewrite
    → FastAPI :8000             # asset-tracker/backend
      → stock-api / 新浪 / Yahoo 盘前盘后行情
```

## 本地开发

```bash
# 1. 首次安装
npm run asset-tracker:install

# 2. 构建前端到 public/asset-tracker
npm run asset-tracker:build

# 3. 启动行情/组合 API（8000）
npm run asset-tracker:api

# 4. 启动网站
npm run dev
```

打开：http://127.0.0.1:3000/tools/asset-tracker  
或：http://127.0.0.1:3000/asset-tracker/

独立前后端热更新（不经过 Next）：

```bash
npm run asset-tracker:dev   # :8000 + Vite :5173
```

## 环境变量

网站根目录 `.env.local`：

```
ASSET_TRACKER_API_URL=http://127.0.0.1:8000
```

看板可选 `asset-tracker/.env`（Supabase / 盈透等），见 `.env.example`。

## 更新 UI

改 `asset-tracker/frontend/src/*` 后重新：

```bash
npm run asset-tracker:build
```
