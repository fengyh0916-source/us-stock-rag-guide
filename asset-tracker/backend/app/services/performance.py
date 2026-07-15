"""组合收益曲线：按「当前持仓 × 历史收盘价」回溯。

说明（与主流组合工具一致的简化假设）：
- 不记录买卖流水时，无法还原真实账户净值；
- 采用 buy-and-hold 回溯：假设整段区间内持仓数量不变；
- 现金按当前余额常数计入；
- 跨币种用当前汇率折算到展示币种。
"""

from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from ..models import Holding, Portfolio
from . import fx as fx_service
from . import quotes as quote_service

logger = logging.getLogger(__name__)

try:
    import akshare as ak  # type: ignore
except Exception:  # pragma: no cover
    ak = None  # type: ignore

RANGE_DAYS = {
    "1m": 35,
    "3m": 100,
    "6m": 200,
    "1y": 400,
}

_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://fundf10.eastmoney.com/",
}


def _fetch_cn_fund_history(symbol: str, start: str, end: str) -> List[Tuple[str, float]]:
    """东财基金历史单位净值。start/end 为 YYYYMMDD。"""
    sym = quote_service.normalize_symbol("cn", symbol)
    try:
        start_dt = datetime.strptime(start, "%Y%m%d").date()
        end_dt = datetime.strptime(end, "%Y%m%d").date()
    except ValueError:
        return []
    start_s = start_dt.isoformat()
    end_s = end_dt.isoformat()
    url = "https://api.fund.eastmoney.com/f10/lsjz"
    out: List[Tuple[str, float]] = []
    page = 1
    page_size = 50
    try:
        with httpx.Client(timeout=12.0) as client:
            while page <= 40:
                resp = client.get(
                    url,
                    params={
                        "fundCode": sym,
                        "pageIndex": page,
                        "pageSize": page_size,
                        "startDate": start_s,
                        "endDate": end_s,
                    },
                    headers=_HTTP_HEADERS,
                )
                resp.raise_for_status()
                text = resp.text.strip()
                # 可能是纯 JSON，也可能包在 callback 里
                if text.startswith("jQuery") or text.startswith("callback"):
                    m = re.search(r"\((\{.*\})\)\s*;?\s*$", text, re.S)
                    payload = json.loads(m.group(1)) if m else {}
                else:
                    payload = resp.json()
                data = (payload.get("Data") or {}) if isinstance(payload, dict) else {}
                rows = data.get("LSJZList") or []
                if not rows:
                    break
                for row in rows:
                    d = str(row.get("FSRQ") or "")[:10]
                    raw = row.get("DWJZ")
                    if not d or raw in (None, ""):
                        continue
                    try:
                        px = float(raw)
                    except (TypeError, ValueError):
                        continue
                    if px > 0:
                        out.append((d, px))
                total = int(data.get("TotalCount") or 0)
                if page * page_size >= total or len(rows) < page_size:
                    break
                page += 1
    except Exception as exc:
        logger.info("cn fund hist %s fail: %s", sym, exc)
        return []
    out.sort(key=lambda x: x[0])
    return out


def _fetch_cn_history(symbol: str, start: str, end: str) -> List[Tuple[str, float]]:
    # 场外基金优先走净值历史
    if quote_service._looks_like_cn_open_fund(symbol):  # noqa: SLF001
        fund_hist = _fetch_cn_fund_history(symbol, start, end)
        if fund_hist:
            return fund_hist

    if ak is not None:
        prefixed = quote_service._cn_prefixed(symbol)  # noqa: SLF001
        try:
            df = ak.stock_zh_a_daily(
                symbol=prefixed, start_date=start, end_date=end, adjust="qfq"
            )
            if df is not None and not df.empty:
                out: List[Tuple[str, float]] = []
                for _, row in df.iterrows():
                    d = str(row["date"])[:10]
                    out.append((d, float(row["close"])))
                return out
        except Exception as exc:
            logger.info("cn hist %s fail: %s", symbol, exc)

    # 股票日线失败时再试基金（用户把基金当股票录入）
    return _fetch_cn_fund_history(symbol, start, end)


def _fetch_us_history(symbol: str, start: str, end: str) -> List[Tuple[str, float]]:
    if ak is None:
        return []
    try:
        df = ak.stock_us_daily(symbol=symbol, adjust="qfq")
        if df is None or df.empty:
            return []
        # filter date range
        start_dt = datetime.strptime(start, "%Y%m%d").date()
        end_dt = datetime.strptime(end, "%Y%m%d").date()
        out: List[Tuple[str, float]] = []
        for _, row in df.iterrows():
            d = row["date"]
            if hasattr(d, "date"):
                dd = d.date() if hasattr(d, "date") else d
            else:
                dd = datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
            if dd < start_dt or dd > end_dt:
                continue
            out.append((dd.isoformat(), float(row["close"])))
        return out
    except Exception as exc:
        logger.info("us hist %s fail: %s", symbol, exc)
        return []


def _history_for(market: str, symbol: str, start: str, end: str) -> List[Tuple[str, float]]:
    if market == "cn":
        return _fetch_cn_history(symbol, start, end)
    if market == "us":
        return _fetch_us_history(symbol, start, end)
    return []


def build_performance(
    db: Session,
    range_key: str = "3m",
    display_currency: str = "CNY",
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    if range_key not in RANGE_DAYS:
        range_key = "3m"
    if display_currency not in ("USD", "CNY"):
        display_currency = "CNY"

    fx = fx_service.get_usd_cny_rate()
    rates = fx.get("rates") or {"USD": 1.0, "CNY": float(fx["rate"]), "HKD": 7.8}

    pq = db.query(Portfolio)
    if user_id is not None:
        pq = pq.filter(Portfolio.user_id == user_id)
    portfolios = {p.id: p for p in pq.all()}
    holdings_q = db.query(Holding)
    if user_id is not None:
        holdings_q = holdings_q.filter(Holding.portfolio_id.in_(list(portfolios.keys()) or [-1]))
    holdings = holdings_q.all()
    if not holdings:
        return {
            "range": range_key,
            "display_currency": display_currency,
            "method": "holdings_backtest",
            "method_label": "持仓回溯",
            "points": [],
            "start_value": None,
            "end_value": None,
            "cost_basis": None,
            "pnl": None,
            "pnl_pct": None,
            "vs_cost_pct": None,
            "fx_date": fx.get("date"),
            "message": "暂无持仓，无法生成收益曲线",
        }

    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=RANGE_DAYS[range_key])
    start_s = start_dt.strftime("%Y%m%d")
    end_s = end_dt.strftime("%Y%m%d")

    # 现金常数（原币）；股票按 (market, symbol) 汇总数量与成本
    cash_by_ccy: Dict[str, float] = {"USD": 0.0, "CNY": 0.0, "HKD": 0.0}
    stock_items: List[Tuple[str, str, float, str, float]] = []  # m, s, qty, ccy, cost

    for h in holdings:
        p = portfolios.get(h.portfolio_id)
        if not p:
            continue
        if h.asset_type == "cash" or p.market == "cash":
            ccy = h.currency if h.currency in cash_by_ccy else "CNY"
            cash_by_ccy[ccy] = cash_by_ccy.get(ccy, 0.0) + float(h.quantity)
        elif p.market in ("us", "cn"):
            ccy = "USD" if p.market == "us" else "CNY"
            stock_items.append(
                (
                    p.market,
                    h.symbol,
                    float(h.quantity),
                    ccy,
                    float(h.quantity) * float(h.cost_price),
                )
            )

    # 拉历史；同标的数量/成本合并
    hist_map: Dict[Tuple[str, str], Dict[str, float]] = {}
    qty_map: Dict[Tuple[str, str], Tuple[float, str]] = {}
    cost_native: Dict[Tuple[str, str], float] = {}
    for m, s, q, c, cost in stock_items:
        key = (m, s)
        if key in qty_map:
            qty_map[key] = (qty_map[key][0] + q, c)
            cost_native[key] = cost_native[key] + cost
        else:
            qty_map[key] = (q, c)
            cost_native[key] = cost

    # 总成本（展示币种）= 股票成本 + 现金余额
    cost_basis = 0.0
    for key, (qty, ccy) in qty_map.items():
        cost_basis += fx_service.convert(cost_native.get(key, 0.0), ccy, display_currency, rates)
    for ccy, bal in cash_by_ccy.items():
        if bal:
            cost_basis += fx_service.convert(bal, ccy, display_currency, rates)

    def _one(item: Tuple[str, str]) -> Tuple[Tuple[str, str], Dict[str, float]]:
        m, s = item
        rows = _history_for(m, s, start_s, end_s)
        return item, {d: px for d, px in rows}

    with ThreadPoolExecutor(max_workers=min(8, max(1, len(qty_map)))) as pool:
        futs = [pool.submit(_one, k) for k in qty_map]
        for fut in as_completed(futs):
            key, series = fut.result()
            hist_map[key] = series

    # 交易日并集
    all_dates: set[str] = set()
    for series in hist_map.values():
        all_dates.update(series.keys())
    if not all_dates:
        # 仅现金
        cash_total = sum(
            fx_service.convert(v, c, display_currency, rates) for c, v in cash_by_ccy.items()
        )
        today = end_dt.strftime("%Y-%m-%d")
        return {
            "range": range_key,
            "display_currency": display_currency,
            "method": "holdings_backtest",
            "method_label": "持仓回溯",
            "points": [{"date": today, "value": cash_total, "return_pct": 0.0}],
            "start_value": cash_total,
            "end_value": cash_total,
            "cost_basis": round(cash_total, 2),
            "pnl": 0.0,
            "pnl_pct": 0.0,
            "vs_cost_pct": 0.0,
            "fx_date": fx.get("date"),
            "message": "仅有现金持仓",
        }

    dates = sorted(all_dates)
    # forward-fill 各标的价格
    last_px: Dict[Tuple[str, str], Optional[float]] = {k: None for k in qty_map}
    raw_points: List[Dict[str, Any]] = []

    for d in dates:
        total = 0.0
        for key, (qty, ccy) in qty_map.items():
            series = hist_map.get(key) or {}
            if d in series:
                last_px[key] = series[d]
            px = last_px[key]
            if px is None:
                continue
            total += fx_service.convert(qty * px, ccy, display_currency, rates)
        for ccy, bal in cash_by_ccy.items():
            if bal:
                total += fx_service.convert(bal, ccy, display_currency, rates)
        raw_points.append({"date": d, "value": round(total, 2)})

    if not raw_points:
        return {
            "range": range_key,
            "display_currency": display_currency,
            "method": "holdings_backtest",
            "method_label": "持仓回溯",
            "points": [],
            "start_value": None,
            "end_value": None,
            "cost_basis": round(cost_basis, 2),
            "pnl": None,
            "pnl_pct": None,
            "vs_cost_pct": None,
            "fx_date": fx.get("date"),
            "message": "历史行情暂不可用",
        }

    start_value = raw_points[0]["value"]
    end_value = raw_points[-1]["value"]
    pnl = end_value - start_value
    pnl_pct = (pnl / start_value) if start_value else None
    vs_cost_pct = ((end_value - cost_basis) / cost_basis) if cost_basis else None

    # 区间累计收益率：以区间首日市值为 0 基准
    points: List[Dict[str, Any]] = []
    for p in raw_points:
        rp = 0.0 if not start_value else (p["value"] - start_value) / start_value
        points.append(
            {
                "date": p["date"],
                "value": p["value"],
                "return_pct": round(rp, 6),
            }
        )

    return {
        "range": range_key,
        "display_currency": display_currency,
        "method": "holdings_backtest",
        "method_label": "持仓回溯",
        "points": points,
        "start_value": start_value,
        "end_value": end_value,
        "cost_basis": round(cost_basis, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": pnl_pct,
        "vs_cost_pct": vs_cost_pct,
        "fx_date": fx.get("date"),
        "message": None,
        # 口径说明（产品文档 / 悬浮提示用）
        "formula": {
            "daily_value": "Σ(当前数量 × 当日收盘价) + 现金，折算为展示币种",
            "period_return": "(区间末日市值 - 区间首日市值) / 区间首日市值",
            "assumption": "区间内持仓数量不变（不使用买入日期）",
        },
    }
