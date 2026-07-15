# 部署指南（个人多设备、无登录）

目标：任意电脑打开同一个网址，看到同一份持仓数据。

## 架构

```
浏览器 → Vercel 前端 → Render 后端 API → Supabase Postgres
```

**不需要注册登录。** 知道网址即可访问（请勿公开分享链接）。

---

## 你需要的账号（都有免费档）

1. [GitHub](https://github.com) — 放代码  
2. [Supabase](https://supabase.com) — 数据库  
3. [Render](https://render.com) — 跑 Python 后端  
4. [Vercel](https://vercel.com) — 跑前端  

---

## 一键准备清单

### 1. Supabase（约 5 分钟）

1. New Project → 记下数据库密码  
2. **SQL Editor** → 粘贴并运行仓库内 `supabase/schema.sql`  
3. **Project Settings → Database**  
   - Connection string → **URI**  
   - 模式选 **Session** 或 **Transaction** pooler（端口 6543）  
   - 把 `[YOUR-PASSWORD]` 换成真实密码  
4. 得到类似：

```
postgresql://postgres.xxxx:密码@aws-0-xx.pooler.supabase.com:6543/postgres
```

保存为 `DATABASE_URL`（密码里的 `@ #` 等要做 URL 编码）。

### 2. GitHub

```bash
cd /Users/akoil/asset-tracker
git init
git add .
git commit -m "Deploy personal asset dashboard"
gh auth login          # 浏览器登录
gh repo create asset-tracker --private --source=. --push
```

### 3. Render 后端

1. Dashboard → **New → Blueprint** 或 **Web Service**  
2. 连接 GitHub 仓库 `asset-tracker`  
3. 若手填 Web Service：

| 项 | 值 |
|----|-----|
| Runtime | Python 3 |
| Build | `pip install -r backend/requirements.txt && cd backend/quote-bridge && npm install` |
| Start | `uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port $PORT` |
| Env `DATABASE_URL` | 上一步 Supabase URI |
| Env `PYTHON_VERSION` | `3.11.0` |

4. 部署完成后打开：`https://xxx.onrender.com/api/health`  
   应看到 `{"ok":true,...}`

> Free 档休眠后首次访问可能要等 30～60 秒。

### 4. Vercel 前端

```bash
cd /Users/akoil/asset-tracker/frontend
vercel login
vercel link
vercel env add VITE_API_BASE_URL   # 填 https://xxx.onrender.com 不要末尾斜杠
vercel --prod
```

或网页：Import 仓库 → Root Directory = `frontend` → Environment Variable：

```
VITE_API_BASE_URL=https://你的-render-域名
```

### 5. 验证

1. 打开 Vercel 给的网址  
2. 点「演示数据」  
3. 另一台电脑 / 手机打开同一网址 → 应看到相同数据  

---

## 本地继续开发（连云库）

```bash
export DATABASE_URL='postgresql://...'
cd /Users/akoil/asset-tracker
source .venv/bin/activate
uvicorn app.main:app --app-dir backend --reload --port 8000
```

不设 `DATABASE_URL` 时仍用本地 `data/portfolio.db`。

---

## 安全提醒（无登录时）

- 仓库建议 **Private**  
- 网址不要发朋友圈 / 群  
- 不要把 `DATABASE_URL` 写进前端  
- 以后要更安全可再加访问密码  

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 前端能开但没数据 | 检查 `VITE_API_BASE_URL` 是否指向 Render，且无多余 `/` |
| CORS 报错 | 后端已 `allow_origins=["*"]`，确认请求打到 Render 不是 localhost |
| Render 构建失败 | 确认 Node 可用；Build 里含 `quote-bridge && npm install` |
| 数据库连不上 | 用 Pooler URI；密码 URL 编码；Supabase 项目未暂停 |
