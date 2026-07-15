# 公开上线操作手册

当前代码保留两种运行方式：

- 本地开发：SQLite 用户库、JSON 问答额度，方便零配置调试。
- 公开环境：Supabase Auth、Postgres 原子额度、Postgres 资产数据。生产环境不会自动回退到本地账号库。

## 1. 初始化 Supabase

在同一个 Supabase 项目的 SQL Editor 依次执行：

1. `supabase/auth_and_quota.sql`
2. `supabase/analytics.sql`
3. `asset-tracker/supabase/schema.sql`
4. 如需使用 Supabase RAG 表，再执行 `supabase/schema.sql`

在 Authentication 中开启邮箱确认。网站已兼容 Supabase 免费项目默认的“确认注册链接”：用户点击邮件链接后，回到网站即可完成登录，不需要额外配置 SMTP。

如果后续接入自定义 SMTP，也可以把注册邮件改为 6 位验证码模板（使用 Supabase 的 `{{ .Token }}` 变量）；本地账号模式仍支持验证码流程。

## 2. 配置网站环境变量

公开部署至少需要：

```text
AUTH_SECRET=<openssl rand -hex 32>
AUTH_STORAGE_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
EMAIL_VERIFICATION_REQUIRED=true
NEXT_PUBLIC_CONTACT_EMAIL=<公开联系邮箱>
ADMIN_EMAILS=<可以访问数据看板的邮箱，多个用英文逗号分隔>
DEEPSEEK_API_KEY=<DeepSeek API key>
DATABASE_URL=<Supabase Postgres 连接串>
ENVIRONMENT=production
ALLOWED_ORIGINS=https://<site-domain>
```

仓库使用 Vercel Services 同时部署网站、RAG Agent 与资产 API。Vercel 会根据服务名自动生成 `AGENT_URL` 和 `ASSET_TRACKER_API_URL`，无需手工填写两个后端域名。

`SUPABASE_SERVICE_ROLE_KEY` 只能放在服务端环境变量，禁止添加 `NEXT_PUBLIC_` 前缀或写入浏览器代码。

## 3. 开启免费数据统计

1. 在 Vercel 项目中打开 **Analytics**，启用 Web Analytics。
2. 在 Vercel 项目中打开 **Speed Insights**，启用真实性能统计。
3. 重新部署。网站已在根布局接入官方 SDK，部署后会自动开始记录 PV、访客、来源和性能。
4. 使用 `ADMIN_EMAILS` 中的账号登录，访问 `/admin/metrics` 查看 Agent 提问、成功率、耗时、文章点击和反馈。

Vercel Hobby 版不支持自定义事件，所以产品行为保存在 Supabase 免费数据库。产品事件不包含问题原文、邮箱、原始 IP 或持仓。

## 4. 配置两个 Python 服务

两个 FastAPI 服务与网站在同一个 Vercel 项目中发布，生产环境变量共用。Agent 需要：

```text
ENVIRONMENT=production
DEEPSEEK_API_KEY=<key>
RATE_LIMIT_PER_MINUTE=20
```

资产后端：

```text
ENVIRONMENT=production
DATABASE_URL=<Supabase Postgres connection string>
AUTH_SECRET=<与网站完全一致>
```

在 Vercel 项目设置中把 Framework Preset 设为 **Services**。生产环境缺少密钥、数据库连接或 CORS 域名时，Python 服务会拒绝启动。

## 5. 旧数据迁移说明

Supabase Auth 无法直接使用当前 SQLite 中的 scrypt 密码哈希。开始公开测试时，旧测试账号应重新注册并验证邮箱。资产数据迁移前需要先取得新 Supabase 用户 ID，再把旧组合的 `user_id` 映射到新 ID；不要把空 `user_id` 的历史组合直接导入生产库。

## 6. 发布门禁

```bash
npm run preflight:production
npm run lint
npm run build
npm run asset-tracker:build

cd agent
.venv/bin/python -m unittest discover -s backend/tests -p 'test_*.py' -v
.venv/bin/python eval/run_eval_v2.py

cd ../asset-tracker
PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -p 'test_*.py' -v
```

离线评测通过后，还需要运行当前版本的真实 API 评测。幻觉率、安全违规或身份隔离测试未通过时，不应开放注册。

## 7. 首批发布方式

先使用邀请制开放少量账号，观察错误率、模型成本、额度拒绝率和用户反馈。确认数据库备份、恢复、告警和真实 API 评测稳定后，再解除邀请限制。
