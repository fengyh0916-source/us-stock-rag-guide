# 个人资产管理看板（投资组合追踪器）

Web 端个人资产看板：管理 **美股 + A 股 + 现金** 多账户，支持「全部账户」汇总；顶部总市值可在 **USD / CNY** 间切换（默认人民币）；持仓明细保持原币；**红涨绿跌**。

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | React + TypeScript + Vite → 部署 **Vercel** |
| 后端 | FastAPI → 部署 Render / Railway 等 |
| 数据库 | 本地 SQLite，或 **Supabase Postgres**（`DATABASE_URL`） |
| 行情 | **主：`stock-api`（腾讯→新浪→东财自动兜底）**；回退：新浪/Yahoo/akshare |
| 自动刷新 | 开市约 **3 秒**；休市约 **3 分钟** |
| 汇率 | Frankfurter（ECB，免费） |

## 盈透持仓同步

选中 **美股** 组合后，持仓明细标题右侧会出现 **「同步盈透持仓」**。

1. 本机启动 **IB Gateway** 或 **TWS**，登录账户  
2. 配置 → API → 勾选 **Enable ActiveX and Socket Clients**  
3. 端口（默认）：Gateway 实盘 `4001` / 模拟 `4002`；TWS 实盘 `7496` / 模拟 `7497`  
4. 后端环境变量（可选）：`IB_HOST` `IB_PORT` `IB_CLIENT_ID`  
5. 本地跑后端（`localhost:8000`）后点同步  

**会同步什么**

| 字段 | 来源 |
|------|------|
| 代码 / 数量 / 平均成本 | `positions` / `portfolio` |
| 市价 | 优先 `portfolio.marketPrice`，否则 `reqMktData` 快照 |
| 若无 IB 行情权限 | 市价为空，看板仍用 stock-api 刷新现价 |

**注意**：云端 Railway 后端访问不到你电脑上的 Gateway。同步盈透请在 **本地后端** 使用；同步写入的数据若 `DATABASE_URL` 指向云库，则各设备仍能看到。

## 本地启动

```bash
cd /Users/akoil/asset-tracker
./start.sh
```

或：

```bash
# 后端
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

# 前端
cd frontend && npm install && npm run dev
```

- 前端：http://127.0.0.1:5173  
- 后端文档：http://127.0.0.1:8000/docs  

可点 **「演示数据」**（含现金账户）。

## 产品规则（已确认）

1. **默认汇总币种：人民币**；可切换美元  
2. 切换只影响顶部四卡与侧栏汇总；明细原币不变  
3. **现金持仓**：余额记市值，盈亏为 0；支持 CNY / USD  
4. **红涨绿跌**  
5. 无历史曲线、无交易流水  

## 部署（Vercel + Supabase）

详见 **[DEPLOY.md](./DEPLOY.md)**。

摘要：

1. Supabase 执行 `supabase/schema.sql`，拿到 `DATABASE_URL`  
2. 后端设 `DATABASE_URL` 后部署  
3. 前端 Vercel 设 `VITE_API_BASE_URL` 指向后端  

## 行情是否够用？

**够用。** 个人实时看板 + 开市 3 秒刷新，新浪/Yahoo/Frankfurter 已覆盖美股、A 股、汇率。  
若某只代码长期拉不到、或被限流，再告诉我换源即可。
