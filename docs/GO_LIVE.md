# 对外开放上线手册

目标形态：**教程匿名可读**；**助手需登录 + 日配额**；**资产看板需登录 + 按用户隔离**。

---

## 1. 架构与端口

| 服务 | 默认地址 | 作用 |
|------|----------|------|
| Next.js 网站 | `:3000` | 页面、鉴权、代理 `/api/*` |
| RAG Agent | `:8001` | 助手检索 + 生成 |
| Asset Tracker API | `:8000` | 多用户资产数据 |

浏览器只访问网站域名；助手经 `/api/chat`，资产经 Next rewrite 到 Asset API。

---

## 2. 环境变量（生产必配）

在网站根目录 `.env` / 部署平台 Secrets：

```bash
# 会话签名（Next 与 Asset API 必须一致）
AUTH_SECRET=   # openssl rand -hex 32

# 助手后端
AGENT_URL=http://127.0.0.1:8001
# agent 自己的 .env：
# DEEPSEEK_API_KEY=...
# DEEPSEEK_MODEL=deepseek-v4-flash

# 资产后端
ASSET_TRACKER_API_URL=http://127.0.0.1:8000

# 助手日配额
CHAT_DAILY_LIMIT=50

# 生产 CORS（逗号分隔，不要用 *）
ALLOWED_ORIGINS=https://你的域名.com

# 邮箱验证（Resend）
RESEND_API_KEY=
EMAIL_FROM=美股扫盲 <noreply@你的域名.com>
EMAIL_SITE_NAME=美股扫盲导航
```

Asset API 需能读到 **同一 `AUTH_SECRET`**（已支持从网站根 `.env.local` 自动加载）。

---

## 3. 本地一键启动

```bash
# 首次
npm install
npm run agent:install
npm run asset-tracker:install
npm run agent:reindex          # 构建知识库
npm run asset-tracker:build    # 构建看板前端到 public/

# 日常
chmod +x scripts/start-all.sh scripts/stop-all.sh
./scripts/start-all.sh

# 健康检查
curl -s http://127.0.0.1:3000/api/health | jq .

./scripts/stop-all.sh
```

或分别：

```bash
npm run asset-tracker:api   # :8000
npm run agent:dev           # :8001
npm run dev                 # :3000
```

生产网站：

```bash
npm run build && npm run start
```

Agent / Asset 用 `uvicorn` **不要加 --reload**，并用 systemd / Docker / pm2 保活。

---

## 4. 上线检查清单

### 安全

- [ ] `AUTH_SECRET` 强随机且三端一致  
- [ ] `ALLOWED_ORIGINS` 仅站点域名  
- [ ] API Key 仅服务端，未进前端包  
- [ ] HTTPS（反代 Nginx / Caddy / 云平台）  
- [ ] 生产关闭 Next dev 指示器（`next start`）  

### 产品

- [ ] 未登录可读帖  
- [ ] 未登录点助手 → 登录弹窗  
- [ ] 未登录进资产 → 门禁 / 307  
- [ ] **注册后直接登录，不发送邮箱确认邮件**  
- [ ] 用户 A/B 持仓互不可见  
- [ ] 助手超日配额 → 429 中文提示  
- [ ] `/privacy` `/terms` 可访问，页脚有免责  

### 数据

- [ ] 备份 `data/auth/users.db`  
- [ ] 备份 `asset-tracker/data/portfolio.db`（或 Postgres `DATABASE_URL`）  
- [ ] 备份 `agent/data/index/chunks.json`  

### 运维

- [ ] `GET /api/health` 监控  
- [ ] DeepSeek 账单/用量告警  
- [ ] 日志轮转（`.run/*.log` 或系统 journal）  

---

## 5. 数据位置

| 数据 | 路径 |
|------|------|
| 用户账号 | `data/auth/users.db`（SQLite；旧 `users.json` 会自动迁移） |
| 助手日配额 | `data/auth/chat-quota.json` |
| 资产持仓 | `asset-tracker/data/portfolio.db` 或 `DATABASE_URL` |
| 知识库 | `agent/data/index/chunks.json` |

---

## 6. 限流一览

| 接口 | 策略 |
|------|------|
| 注册 | 每 IP 每小时 5 次 |
| 登录 | 每 IP 每 15 分钟 30 次 |
| 助手提问 | 每用户每日 `CHAT_DAILY_LIMIT`（默认 50） |
| Agent 服务 | 每 IP 每分钟约 20 次（可配） |

---

## 7. 推荐部署拓扑（最小）

```text
用户 → CDN/HTTPS → Next.js(:3000)
                      ├─ /api/chat → Agent(:8001)  [内网]
                      └─ /api/dashboard 等 rewrite → Asset(:8000)  [内网]
```

Agent / Asset **不要**对公网裸暴露；只监听 `127.0.0.1` 或 VPC 内网。

---

## 8. 已知局限（对用户/面试诚实说）

- 鉴权与配额为**单机文件/SQLite**；多机水平扩展需 Redis + 共享 DB  
- 当前为降低 Demo 注册摩擦已关闭邮箱确认；账号邮箱的真实性不做校验  
- 资产行情依赖第三方，非交易级实时  
- 助手为科普 RAG，有日配额与安全拒答  

---

## 9. 故障速查

| 现象 | 排查 |
|------|------|
| 登录后资产 401 | `AUTH_SECRET` 是否一致；Cookie 是否带上 |
| 助手一直失败 | Agent 是否启动；`AGENT_URL`；`/api/health` |
| 看板空白 | 是否登录；该用户是否有数据；可点「演示数据」 |
| 注册 429 | 触发 IP 注册限流，稍后重试 |
