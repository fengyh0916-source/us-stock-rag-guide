from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .auth import get_user_id_from_request, is_production, validate_auth_configuration
from .database import SessionLocal, ensure_schema, get_db
from .models import Holding, Portfolio
from .schemas import (
    DashboardOut,
    HoldingCreate,
    HoldingOut,
    HoldingUpdate,
    PortfolioCreate,
    PortfolioOut,
    PortfolioSummary,
    PortfolioUpdate,
    ReorderBody,
)
from .services import fx as fx_service
from .services import ib_sync as ib_sync_service
from .services import market_hours
from .services import performance as performance_service
from .services import quotes as quote_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="个人资产管理看板", version="1.0.0")


def _cors_origins() -> list[str]:
    import os

    raw = (os.getenv("ALLOWED_ORIGINS") or "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    if is_production():
        raise RuntimeError("生产环境必须配置 ALLOWED_ORIGINS，禁止使用通配符跨域")
    return ["*"]


_origins = _cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # credentials + "*" 浏览器会拒绝；有明确域名时才开 credentials
    allow_credentials="*" not in _origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 整页 dashboard 短缓存（跨请求复用，显著降低重复打开耗时）
_dash_lock = threading.Lock()
_dash_cache: dict[str, dict[str, Any]] = {}


def _dash_ttl() -> float:
    # 不复用整页缓存，保证轮询拿到最新价（能力范围内最快）
    return 0.0


@app.on_event("startup")
def on_startup():
    validate_auth_configuration()
    ensure_schema()

    def _warm() -> None:
        # 进程起来后预热汇率 + 全市场行情，让第一位访客更快
        time.sleep(0.5)
        try:
            fx_service.get_usd_cny_rate()
        except Exception as exc:
            logger.info("warm fx fail: %s", exc)
        try:
            db = SessionLocal()
            try:
                items = []
                for h in db.query(Holding).all():
                    p = db.get(Portfolio, h.portfolio_id)
                    if not p or p.market not in ("us", "cn") or h.asset_type == "cash":
                        continue
                    items.append((p.market, h.symbol))
                if items:
                    quote_service.fetch_quotes_batch(items)
                    logger.info("warm quotes ok %s symbols", len(items))
            finally:
                db.close()
        except Exception as exc:
            logger.info("warm quotes fail: %s", exc)

    threading.Thread(target=_warm, name="warm-quotes", daemon=True).start()


def default_currency_for_market(market: str) -> str:
    if market == "us":
        return "USD"
    return "CNY"  # cn / cash 默认人民币


def holding_currency(h: Holding, portfolio: Portfolio) -> str:
    """股票/ETF 强制跟组合市场；现金用自身 currency（USD/CNY/HKD）。"""
    if h.asset_type == "cash" or portfolio.market == "cash":
        if h.currency in ("USD", "CNY", "HKD"):
            return h.currency
        return "CNY"
    # 美股永远 USD，A 股永远 CNY —— 明细原币
    if portfolio.market == "us":
        return "USD"
    if portfolio.market == "cn":
        return "CNY"
    return default_currency_for_market(portfolio.market)


def holding_pnl_adjustment(h: Holding) -> float:
    try:
        return float(getattr(h, "pnl_adjustment", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def holding_to_base(h: Holding, portfolio: Portfolio) -> dict:
    return {
        "id": h.id,
        "portfolio_id": h.portfolio_id,
        "asset_type": h.asset_type,
        "symbol": h.symbol,
        "name": h.name,
        "quantity": h.quantity,
        "cost_price": h.cost_price,
        "market": portfolio.market,
        "currency": holding_currency(h, portfolio),
        "sort_order": getattr(h, "sort_order", 0) or 0,
        "pnl_adjustment": holding_pnl_adjustment(h),
    }


def is_cash_holding(h: Holding, portfolio: Portfolio) -> bool:
    return h.asset_type == "cash" or portfolio.market == "cash"


def user_portfolios_query(db: Session, user_id: str):
    return (
        db.query(Portfolio)
        .filter(Portfolio.user_id == user_id)
        .order_by(Portfolio.sort_order.asc(), Portfolio.id.asc())
    )


def get_owned_portfolio(db: Session, user_id: str, portfolio_id: int) -> Portfolio:
    p = (
        db.query(Portfolio)
        .filter(Portfolio.id == portfolio_id, Portfolio.user_id == user_id)
        .first()
    )
    if not p:
        raise HTTPException(404, "组合不存在")
    return p


def get_owned_holding(db: Session, user_id: str, holding_id: int) -> tuple[Holding, Portfolio]:
    h = db.get(Holding, holding_id)
    if not h:
        raise HTTPException(404, "持仓不存在")
    p = get_owned_portfolio(db, user_id, h.portfolio_id)
    return h, p


# ---------- Portfolios ----------


@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


@app.get("/api/portfolios", response_model=list[PortfolioOut])
def list_portfolios(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    return user_portfolios_query(db, user_id).all()


@app.post("/api/portfolios", response_model=PortfolioOut)
def create_portfolio(
    body: PortfolioCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "组合名称不能为空")
    max_order = user_portfolios_query(db, user_id).count()
    p = Portfolio(
        user_id=user_id,
        name=name,
        market=body.market,
        sort_order=max_order + 1,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@app.put("/api/portfolios/reorder")
def reorder_portfolios(
    body: ReorderBody,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    owned = {p.id: p for p in user_portfolios_query(db, user_id).all()}
    for idx, pid in enumerate(body.ids):
        p = owned.get(pid)
        if p:
            p.sort_order = idx
    db.commit()
    return {"ok": True}


@app.patch("/api/portfolios/{portfolio_id}", response_model=PortfolioOut)
def update_portfolio(
    portfolio_id: int,
    body: PortfolioUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    p = get_owned_portfolio(db, user_id, portfolio_id)
    p.name = body.name.strip()
    db.commit()
    db.refresh(p)
    return p


@app.delete("/api/portfolios/{portfolio_id}")
def delete_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    p = get_owned_portfolio(db, user_id, portfolio_id)
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------- Holdings ----------


@app.get("/api/holdings", response_model=list[HoldingOut])
def list_holdings(
    portfolio_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    portfolios = {p.id: p for p in user_portfolios_query(db, user_id).all()}
    q = db.query(Holding).filter(Holding.portfolio_id.in_(list(portfolios.keys()) or [-1]))
    if portfolio_id is not None:
        if portfolio_id not in portfolios:
            raise HTTPException(404, "组合不存在")
        q = q.filter(Holding.portfolio_id == portfolio_id)
    holdings = q.order_by(Holding.sort_order.asc(), Holding.id.asc()).all()
    out = []
    for h in holdings:
        p = portfolios.get(h.portfolio_id)
        if not p:
            continue
        out.append(HoldingOut(**holding_to_base(h, p)))
    return out


@app.post("/api/holdings", response_model=HoldingOut)
def create_holding(
    body: HoldingCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    p = get_owned_portfolio(db, user_id, body.portfolio_id)

    asset_type = body.asset_type
    if p.market == "cash":
        asset_type = "cash"
    if p.market in ("us", "cn") and asset_type == "cash":
        # 允许在股票组合里记一笔现金
        pass
    if p.market == "us" and asset_type not in ("stock", "etf", "cash"):
        raise HTTPException(400, "美股组合仅支持股票/ETF/现金")
    if p.market == "cn" and asset_type not in ("stock", "etf", "fund", "cash"):
        raise HTTPException(400, "A股组合仅支持股票/ETF/基金/现金")

    if asset_type == "cash":
        currency = body.currency or default_currency_for_market(p.market)
        if currency not in ("USD", "CNY", "HKD"):
            raise HTTPException(400, "现金币种仅支持 USD / CNY / HKD")
        cash_label = {"CNY": "人民币", "USD": "美元", "HKD": "港币"}.get(currency, currency)
        name = body.name.strip() or f"{cash_label}现金"
        # 同一组合同币种现金可多条：用名称生成唯一 symbol
        symbol = body.symbol.strip().upper() or f"CASH-{currency}-{int(datetime.utcnow().timestamp())}"
        cost_price = 1.0
        quantity = body.quantity
    else:
        if p.market == "cash":
            raise HTTPException(400, "现金组合只能添加现金持仓")
        if p.market not in ("us", "cn"):
            raise HTTPException(400, "无效组合市场")
        symbol = quote_service.normalize_symbol(p.market, body.symbol)
        if not symbol:
            raise HTTPException(400, "请填写股票代码")
        currency = default_currency_for_market(p.market)
        cost_price = body.cost_price
        quantity = body.quantity
        name = body.name.strip()
        if not name:
            try:
                q = quote_service.fetch_quote(p.market, symbol)
                name = q.get("name") or symbol
            except Exception:
                name = symbol

    exists = (
        db.query(Holding)
        .filter(Holding.portfolio_id == p.id, Holding.symbol == symbol)
        .first()
    )
    if exists:
        raise HTTPException(400, f"该组合已存在持仓 {symbol}，请直接编辑")

    max_order = (
        db.query(Holding).filter(Holding.portfolio_id == p.id).count()
    )
    h = Holding(
        portfolio_id=p.id,
        asset_type=asset_type,
        symbol=symbol,
        name=name,
        currency=currency,
        quantity=quantity,
        cost_price=cost_price,
        sort_order=max_order + 1,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return HoldingOut(**holding_to_base(h, p))


@app.put("/api/holdings/reorder")
def reorder_holdings(
    body: ReorderBody,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    owned_pids = {p.id for p in user_portfolios_query(db, user_id).all()}
    for idx, hid in enumerate(body.ids):
        h = db.get(Holding, hid)
        if h and h.portfolio_id in owned_pids:
            h.sort_order = idx
    db.commit()
    return {"ok": True}


@app.patch("/api/holdings/{holding_id}", response_model=HoldingOut)
def update_holding(
    holding_id: int,
    body: HoldingUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    h, p = get_owned_holding(db, user_id, holding_id)

    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k == "name" and v is not None:
            setattr(h, k, v.strip())
        elif k == "cost_price" and is_cash_holding(h, p):
            # 现金单位成本固定 1
            h.cost_price = 1.0
        elif v is not None:
            setattr(h, k, v)
    if is_cash_holding(h, p):
        h.asset_type = "cash"
        h.cost_price = 1.0
    db.commit()
    db.refresh(h)
    return HoldingOut(**holding_to_base(h, p))


@app.delete("/api/holdings/{holding_id}")
def delete_holding(
    holding_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    h, _p = get_owned_holding(db, user_id, holding_id)
    db.delete(h)
    db.commit()
    return {"ok": True}


# ---------- Quotes / FX / Dashboard ----------


@app.get("/api/fx")
def get_fx(force: bool = False):
    try:
        return fx_service.get_usd_cny_rate(force=force)
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/market-status")
def get_market_status():
    return market_hours.market_status()


@app.get("/api/ib/status")
def ib_status(_user_id: str = Depends(get_user_id_from_request)):
    """探测本机/配置的 IB Gateway 是否可达（不拉持仓）。"""
    import os
    import socket

    host = os.getenv("IB_HOST", "127.0.0.1")
    port = int(os.getenv("IB_PORT", "4001"))
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2.0)
    try:
        sock.connect((host, port))
        open_ok = True
    except Exception as exc:
        open_ok = False
        err = str(exc)
    finally:
        try:
            sock.close()
        except Exception:
            pass
    return {
        "host": host,
        "port": port,
        "port_open": open_ok,
        "error": None if open_ok else err,
        "hint": None
        if open_ok
        else "请启动 IB Gateway 或 TWS，并开启 API。Gateway 实盘默认 4001，模拟 4002；TWS 实盘 7496，模拟 7497。",
    }


@app.post("/api/ib/sync")
def ib_sync(
    portfolio_id: int = Query(..., description="目标美股组合 ID"),
    replace: bool = Query(False, description="是否先清空该组合股票再全量写入"),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    """从盈透网关同步美股持仓到指定组合。"""
    p = get_owned_portfolio(db, user_id, portfolio_id)
    if p.market != "us":
        raise HTTPException(400, "只能同步到「美股」类型组合")
    try:
        result = ib_sync_service.sync_to_portfolio(
            db, p, Holding, replace=replace
        )
        return result
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        logger.exception("IB sync failed")
        raise HTTPException(502, f"盈透同步失败: {exc}") from exc


@app.get("/api/ib/positions")
def ib_positions_preview(_user_id: str = Depends(get_user_id_from_request)):
    """预览盈透持仓（不写入数据库），便于调试。"""
    try:
        return ib_sync_service.fetch_ib_positions()
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        logger.exception("IB positions failed")
        raise HTTPException(502, f"读取盈透持仓失败: {exc}") from exc


@app.get("/api/performance")
def get_performance(
    range: str = Query("3m", pattern="^(1m|3m|6m|1y)$"),
    display_currency: str = Query("CNY", pattern="^(USD|CNY)$"),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    """收益曲线：按当前持仓回溯（主流组合工具在无流水时的常见做法）。"""
    try:
        return performance_service.build_performance(
            db,
            range_key=range,
            display_currency=display_currency,
            user_id=user_id,
        )
    except Exception as exc:
        logger.exception("performance failed")
        raise HTTPException(502, f"收益曲线生成失败: {exc}") from exc


@app.get("/api/quotes")
def get_quotes(
    market: str = Query(..., pattern="^(us|cn)$"),
    symbols: str = Query(..., description="逗号分隔代码"),
    _user_id: str = Depends(get_user_id_from_request),
):
    syms = [s.strip() for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(400, "请提供代码")
    if len(syms) > 50:
        raise HTTPException(400, "单次最多查询 50 个标的")
    items = [(market, s) for s in syms]
    batch = quote_service.fetch_quotes_batch(items)
    return {"quotes": list(batch.values())}


@app.get("/api/dashboard", response_model=DashboardOut)
def dashboard(
    portfolio_id: Optional[int] = Query(None, description="为空则全部账户"),
    display_currency: str = Query("CNY", pattern="^(USD|CNY)$"),
    force_refresh: bool = False,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    cache_key = f"{user_id}:{display_currency}:{portfolio_id or 'all'}"
    if not force_refresh:
        with _dash_lock:
            hit = _dash_cache.get(cache_key)
            if hit and time.time() - float(hit["ts"]) < _dash_ttl():
                return hit["data"]

    if force_refresh:
        quote_service.clear_cache()

    try:
        fx = fx_service.get_usd_cny_rate()
        usd_cny = float(fx["rate"])
        fx_rates = fx.get("rates") or {"USD": 1.0, "CNY": usd_cny, "HKD": 7.8}
    except Exception as exc:
        raise HTTPException(502, f"汇率不可用: {exc}") from exc

    portfolios = user_portfolios_query(db, user_id).all()
    if portfolio_id is not None:
        if not any(p.id == portfolio_id for p in portfolios):
            raise HTTPException(404, "组合不存在")

    portfolio_map = {p.id: p for p in portfolios}
    holdings_q = db.query(Holding).filter(
        Holding.portfolio_id.in_(list(portfolio_map.keys()) or [-1])
    )
    if portfolio_id is not None:
        holdings_q = holdings_q.filter(Holding.portfolio_id == portfolio_id)
    holdings = holdings_q.order_by(Holding.sort_order.asc(), Holding.id.asc()).all()

    # 仅股票/ETF 拉行情
    items = []
    for h in holdings:
        p = portfolio_map.get(h.portfolio_id)
        if not p or is_cash_holding(h, p):
            continue
        if p.market in ("us", "cn"):
            items.append((p.market, h.symbol))
    uniq = list(
        {
            (m, quote_service.normalize_symbol(m, s)): (m, s) for m, s in items
        }.values()
    )
    batch = quote_service.fetch_quotes_batch(uniq) if uniq else {}

    holding_rows: list[HoldingOut] = []
    for h in holdings:
        p = portfolio_map[h.portfolio_id]
        cur = holding_currency(h, p)
        cash = is_cash_holding(h, p)

        adj = holding_pnl_adjustment(h)
        price_session = None
        if cash:
            price = 1.0
            quote_err = None
            quote_date = None
            name = h.name or h.symbol
            cost_value = h.quantity  # cost_price=1
            market_value = h.quantity
            pnl = 0.0 + adj
            pnl_pct = 0.0 if adj == 0 else (adj / cost_value if cost_value > 0 else None)
        else:
            key = quote_service._cache_key(
                p.market, quote_service.normalize_symbol(p.market, h.symbol)
            )
            q = batch.get(key, {})
            price = q.get("price")
            quote_err = q.get("error")
            quote_date = q.get("quote_date")
            sess = q.get("session")
            if sess in ("pre", "regular", "post"):
                price_session = sess
            name = h.name or q.get("name") or h.symbol
            cost_value = h.quantity * h.cost_price
            market_value = h.quantity * price if price is not None else None
            # 成本价不动：盈亏 = 市值-成本 + 固定修正（手续费等）
            pnl = (market_value - cost_value + adj) if market_value is not None else None
            pnl_pct = (pnl / cost_value) if pnl is not None and cost_value > 0 else None

            if (not h.name or h.name == h.symbol) and q.get("name") and q["name"] != h.symbol:
                h.name = q["name"]
                name = q["name"]

        holding_rows.append(
            HoldingOut(
                id=h.id,
                portfolio_id=h.portfolio_id,
                asset_type=h.asset_type,  # type: ignore
                symbol=h.symbol,
                name=name,
                quantity=h.quantity,
                cost_price=h.cost_price if not cash else 1.0,
                market=p.market,  # type: ignore
                currency=cur,  # type: ignore
                sort_order=getattr(h, "sort_order", 0) or 0,
                pnl_adjustment=adj,
                price=price,
                price_session=price_session,
                market_value=market_value,
                cost_value=cost_value,
                pnl=pnl,
                pnl_pct=pnl_pct,
                weight=None,
                quote_date=quote_date,
                quote_error=quote_err,
            )
        )

    db.commit()

    def to_display(amount: float, currency: str) -> float:
        return fx_service.convert(amount, currency, display_currency, fx_rates)

    total_mv = 0.0
    total_cost = 0.0
    total_adj = 0.0
    for row in holding_rows:
        if row.market_value is None or row.cost_value is None:
            continue
        total_mv += to_display(row.market_value, row.currency)
        total_cost += to_display(row.cost_value, row.currency)
        total_adj += to_display(float(row.pnl_adjustment or 0), row.currency)

    # 含固定盈亏修正，与券商「总盈亏」对齐
    total_pnl = total_mv - total_cost + total_adj
    total_pnl_pct = (total_pnl / total_cost) if total_cost > 0 else None

    display_mvs = []
    for row in holding_rows:
        if row.market_value is None:
            display_mvs.append(0.0)
        else:
            display_mvs.append(to_display(row.market_value, row.currency))
    sum_mv = sum(display_mvs) or 1.0
    for i, row in enumerate(holding_rows):
        if row.market_value is not None:
            row.weight = display_mvs[i] / sum_mv

    # 默认排序：左侧组合顺序 → 组合内 sort_order（不按市值重排）
    p_order = {p.id: (getattr(p, "sort_order", 0) or 0, p.id) for p in portfolios}
    holding_rows.sort(
        key=lambda r: (
            p_order.get(r.portfolio_id, (9999, r.portfolio_id)),
            r.sort_order,
            r.id,
        )
    )

    # 侧栏：当前用户全部组合汇总
    all_holdings = (
        db.query(Holding)
        .filter(Holding.portfolio_id.in_(list(portfolio_map.keys()) or [-1]))
        .all()
    )
    all_items = []
    for h in all_holdings:
        p = portfolio_map.get(h.portfolio_id)
        if not p or is_cash_holding(h, p):
            continue
        if p.market in ("us", "cn"):
            all_items.append((p.market, h.symbol))
    all_uniq = list(
        {
            (m, quote_service.normalize_symbol(m, s)): (m, s) for m, s in all_items
        }.values()
    )
    all_batch = batch
    if portfolio_id is not None and all_uniq:
        all_batch = quote_service.fetch_quotes_batch(all_uniq)

    portfolio_summaries: list[PortfolioSummary] = []
    all_total_mv = 0.0
    all_total_cost = 0.0
    all_count = 0

    for p in portfolios:
        p_holdings = [h for h in all_holdings if h.portfolio_id == p.id]
        mv = 0.0
        cost = 0.0
        adj_sum = 0.0
        count = 0
        for h in p_holdings:
            cur = holding_currency(h, p)
            cash = is_cash_holding(h, p)
            count += 1
            adj_sum += to_display(holding_pnl_adjustment(h), cur)
            if cash:
                c = h.quantity
                cost += to_display(c, cur)
                mv += to_display(c, cur)
            else:
                key = quote_service._cache_key(
                    p.market, quote_service.normalize_symbol(p.market, h.symbol)
                )
                q = all_batch.get(key, {})
                price = q.get("price")
                c = h.quantity * h.cost_price
                cost += to_display(c, cur)
                if price is not None:
                    mv += to_display(h.quantity * price, cur)
        pnl = mv - cost + adj_sum
        pct = (pnl / cost) if cost > 0 else None
        portfolio_summaries.append(
            PortfolioSummary(
                id=p.id,
                name=p.name,
                market=p.market,  # type: ignore
                sort_order=getattr(p, "sort_order", 0) or 0,
                market_value=mv,
                cost_value=cost,
                pnl=pnl,
                pnl_pct=pct,
                holding_count=count,
            )
        )
        all_total_mv += mv
        all_total_cost += cost
        all_count += count

    # 全部账户：汇总各组合已含调整的盈亏
    all_pnl = sum(s.pnl for s in portfolio_summaries)
    all_pct = (all_pnl / all_total_cost) if all_total_cost > 0 else None
    portfolio_summaries.insert(
        0,
        PortfolioSummary(
            id="all",
            name="全部账户",
            market=None,
            sort_order=-1,
            market_value=all_total_mv,
            cost_value=all_total_cost,
            pnl=all_pnl,
            pnl_pct=all_pct,
            holding_count=all_count,
        ),
    )

    status = market_hours.market_status()
    out = DashboardOut(
        display_currency=display_currency,  # type: ignore
        fx_rate=usd_cny,
        fx_date=fx.get("date"),
        fx_source=fx.get("source", "Frankfurter/ECB"),
        total_market_value=total_mv,
        total_cost_value=total_cost,
        total_pnl=total_pnl,
        total_pnl_pct=total_pnl_pct,
        portfolios=portfolio_summaries,
        holdings=holding_rows,
        updated_at=datetime.utcnow().isoformat() + "Z",
        cn_open=bool(status["cn_open"]),
        us_open=bool(status["us_open"]),
        any_open=bool(status["any_open"]),
        poll_seconds=int(status["poll_seconds"]),
    )
    with _dash_lock:
        _dash_cache[cache_key] = {"ts": time.time(), "data": out}
    return out


def _insert_demo_data(db: Session, user_id: str) -> None:
    us = Portfolio(user_id=user_id, name="美股长线", market="us", sort_order=1)
    cn = Portfolio(user_id=user_id, name="A股核心", market="cn", sort_order=2)
    cash = Portfolio(user_id=user_id, name="现金储备", market="cash", sort_order=3)
    db.add_all([us, cn, cash])
    db.flush()

    demo = [
        Holding(
            portfolio_id=us.id,
            asset_type="etf",
            symbol="QQQM",
            name="纳斯达克100",
            currency="USD",
            quantity=190.9924,
            cost_price=245.28,
            sort_order=1,
        ),
        Holding(
            portfolio_id=us.id,
            asset_type="etf",
            symbol="VGT",
            name="科技行业ETF",
            currency="USD",
            quantity=67.9609,
            cost_price=116.73,
            sort_order=2,
        ),
        Holding(
            portfolio_id=us.id,
            asset_type="stock",
            symbol="NVDA",
            name="英伟达",
            currency="USD",
            quantity=35,
            cost_price=208.51,
            sort_order=3,
        ),
        Holding(
            portfolio_id=us.id,
            asset_type="stock",
            symbol="SMH",
            name="半导体ETF",
            currency="USD",
            quantity=7.8879,
            cost_price=633.92,
            sort_order=4,
        ),
        Holding(
            portfolio_id=us.id,
            asset_type="stock",
            symbol="MRVL",
            name="Marvell",
            currency="USD",
            quantity=17.8745,
            cost_price=279.75,
            sort_order=5,
        ),
        Holding(
            portfolio_id=cn.id,
            asset_type="stock",
            symbol="600519",
            name="贵州茅台",
            currency="CNY",
            quantity=10,
            cost_price=1488.0,
            sort_order=1,
        ),
        Holding(
            portfolio_id=cn.id,
            asset_type="etf",
            symbol="510300",
            name="沪深300ETF",
            currency="CNY",
            quantity=5000,
            cost_price=3.85,
            sort_order=2,
        ),
        Holding(
            portfolio_id=cash.id,
            asset_type="cash",
            symbol="CASH-CNY",
            name="人民币活期",
            currency="CNY",
            quantity=85000,
            cost_price=1,
            sort_order=1,
        ),
        Holding(
            portfolio_id=cash.id,
            asset_type="cash",
            symbol="CASH-USD",
            name="美元现金",
            currency="USD",
            quantity=5000,
            cost_price=1,
            sort_order=2,
        ),
        Holding(
            portfolio_id=cash.id,
            asset_type="cash",
            symbol="CASH-HKD",
            name="港币现金",
            currency="HKD",
            quantity=30000,
            cost_price=1,
            sort_order=3,
        ),
    ]
    db.add_all(demo)
    db.commit()


@app.post("/api/seed-demo")
def seed_demo(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    """仅操作当前用户数据：有数据则清空，无数据则写入演示。"""
    owned = user_portfolios_query(db, user_id).all()
    if owned:
        pids = [p.id for p in owned]
        db.query(Holding).filter(Holding.portfolio_id.in_(pids)).delete(
            synchronize_session=False
        )
        db.query(Portfolio).filter(Portfolio.user_id == user_id).delete(
            synchronize_session=False
        )
        db.commit()
        with _dash_lock:
            keys = [k for k in _dash_cache if k.startswith(f"{user_id}:")]
            for k in keys:
                _dash_cache.pop(k, None)
        return {
            "ok": True,
            "action": "cleared",
            "has_data": False,
            "message": "已清空你的全部资产数据",
        }

    _insert_demo_data(db, user_id)
    return {
        "ok": True,
        "action": "seeded",
        "has_data": True,
        "message": "已为你写入演示数据",
    }


@app.get("/api/data-status")
def data_status(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id_from_request),
):
    count = user_portfolios_query(db, user_id).count()
    return {"has_data": count > 0, "portfolio_count": count}
