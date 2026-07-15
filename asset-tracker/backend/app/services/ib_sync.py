"""盈透 IB Gateway / TWS 持仓同步。

连接本机或可访问的 IB Gateway，读取持仓数量、平均成本、未实现盈亏，并尽量取市价。

默认：
  IB_HOST=127.0.0.1
  IB_PORT=4001   # Gateway 实盘 4001 / 模拟 4002；TWS 实盘 7496 / 模拟 7497
  IB_CLIENT_ID=7

市价来源优先级：
  1. ib.portfolio() 里的 marketPrice / marketValue
  2. reqMktData 快照（需行情权限；无权限可能 delayed 或空）
  3. 返回 price=None，由看板现有 stock-api 行情补全

盈亏修正：
  同步时用 IB unrealizedPNL 写入 holdings.pnl_adjustment，
  使「市值−成本+修正」对齐盈透实际浮动盈亏（含手续费等差额），不改成本价。
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_HOST = os.getenv("IB_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.getenv("IB_PORT", "4001"))
# 固定 clientId 容易「already in use」；默认每次随机
_ENV_CLIENT = os.getenv("IB_CLIENT_ID", "").strip()
DEFAULT_CLIENT_ID = int(_ENV_CLIENT) if _ENV_CLIENT else 0
CONNECT_TIMEOUT = float(os.getenv("IB_CONNECT_TIMEOUT", "8"))


def _pick_client_id(explicit: int = 0) -> int:
    if explicit and explicit > 0:
        return explicit
    if DEFAULT_CLIENT_ID > 0:
        return DEFAULT_CLIENT_ID
    return random.randint(50, 200)


def _is_us_stock_like(contract) -> bool:
    """筛选可写入美股组合的标的：STK / ETF。"""
    sec = (getattr(contract, "secType", "") or "").upper()
    currency = (getattr(contract, "currency", "") or "").upper()
    if sec not in ("STK", "ETF"):
        return False
    if currency and currency != "USD":
        return False
    return True


def _fetch_ib_positions_impl(
    host: str,
    port: int,
    client_id: int,
) -> Dict[str, Any]:
    from ib_insync import IB, Stock  # type: ignore

    cid = _pick_client_id(client_id)
    ib = IB()
    errors: List[str] = []
    try:
        try:
            ib.connect(
                host,
                port,
                clientId=cid,
                timeout=CONNECT_TIMEOUT,
                readonly=True,
            )
        except Exception as exc:
            raise RuntimeError(
                f"无法连接盈透网关 {host}:{port} (clientId={cid})。"
                f"请确认 IB Gateway/TWS 已启动，并在设置中开启 API（Enable ActiveX and Socket Clients）。"
                f" 若提示 client id in use，请关闭其它 API 连接或稍后重试。"
                f" 原始错误: {exc}"
            ) from exc

        # 连接后 ib_insync 会自动同步 positions / portfolio
        ib.sleep(1.0)

        portfolio_items = list(ib.portfolio())
        positions = list(ib.positions())

        price_by_conid: Dict[int, Dict[str, float]] = {}
        for item in portfolio_items:
            c = item.contract
            con_id = int(getattr(c, "conId", 0) or 0)
            if not con_id:
                continue
            mp = float(item.marketPrice or 0) if item.marketPrice is not None else 0.0
            mv = float(item.marketValue or 0) if item.marketValue is not None else 0.0
            ac = float(item.averageCost or 0) if item.averageCost is not None else 0.0
            upnl = getattr(item, "unrealizedPNL", None)
            try:
                upnl_f = float(upnl) if upnl is not None else None
            except (TypeError, ValueError):
                upnl_f = None
            price_by_conid[con_id] = {
                "market_price": mp if mp > 0 else 0.0,
                "market_value": mv,
                "average_cost": ac,
                "unrealized_pnl": upnl_f if upnl_f is not None else 0.0,
            }

        # 优先用 portfolio（含市价/未实现盈亏）；positions 仅补缺
        rows: List[Dict[str, Any]] = []
        seen: set[str] = set()

        for item in portfolio_items:
            c = item.contract
            if not _is_us_stock_like(c):
                continue
            symbol = (c.symbol or "").upper().strip()
            if not symbol or symbol in seen:
                continue
            qty = float(item.position or 0)
            if abs(qty) < 1e-12:
                continue
            mp = float(item.marketPrice or 0) if item.marketPrice else None
            if mp is not None and mp <= 0:
                mp = None
            upnl = getattr(item, "unrealizedPNL", None)
            try:
                upnl_f = float(upnl) if upnl is not None else None
            except (TypeError, ValueError):
                upnl_f = None
            seen.add(symbol)
            rows.append(
                {
                    "symbol": symbol,
                    "name": symbol,
                    "quantity": qty,
                    "avg_cost": abs(float(item.averageCost or 0)),
                    "market_price": mp,
                    "market_value": float(item.marketValue or 0),
                    "unrealized_pnl": upnl_f,
                    "account": item.account,
                    "con_id": int(getattr(c, "conId", 0) or 0),
                    "sec_type": getattr(c, "secType", "STK"),
                    "currency": "USD",
                    "exchange": "SMART",
                    "price_from": "ib_portfolio" if mp else "none",
                }
            )

        for pos in positions:
            c = pos.contract
            if not _is_us_stock_like(c):
                continue
            symbol = (c.symbol or "").upper().strip()
            if not symbol or symbol in seen:
                continue
            qty = float(pos.position or 0)
            if abs(qty) < 1e-12:
                continue
            con_id = int(getattr(c, "conId", 0) or 0)
            avg = float(pos.avgCost or 0)
            info = price_by_conid.get(con_id, {})
            if info.get("average_cost"):
                avg = float(info["average_cost"])
            market_price = info.get("market_price") or None
            if market_price is not None and market_price <= 0:
                market_price = None
            upnl_f = info.get("unrealized_pnl")
            if upnl_f == 0.0 and "unrealized_pnl" not in info:
                upnl_f = None
            seen.add(symbol)
            rows.append(
                {
                    "symbol": symbol,
                    "name": symbol,
                    "quantity": qty,
                    "avg_cost": abs(avg) if avg else 0.0,
                    "market_price": market_price,
                    "market_value": info.get("market_value"),
                    "unrealized_pnl": upnl_f,
                    "account": pos.account,
                    "con_id": con_id,
                    "sec_type": getattr(c, "secType", "STK"),
                    "currency": getattr(c, "currency", "USD") or "USD",
                    "exchange": getattr(c, "primaryExchange", None)
                    or getattr(c, "exchange", None)
                    or "SMART",
                    "price_from": "ib_portfolio" if market_price else "none",
                }
            )

        # 补全缺失市价（仅缺价时请求，避免拖慢/卡死）
        missing = [r for r in rows if not r.get("market_price")]
        if missing:
            try:
                contracts = [Stock(r["symbol"], "SMART", "USD") for r in missing[:20]]
                qualified = ib.qualifyContracts(*contracts)
                tickers = [ib.reqMktData(qc, "", False, False) for qc in qualified]
                ib.sleep(1.2)
                by_sym: Dict[str, float] = {}
                for t in tickers:
                    sym = (t.contract.symbol or "").upper()
                    px = None
                    try:
                        px = t.marketPrice()
                    except Exception:
                        px = None
                    if px is None or px != px or px <= 0:
                        px = t.last or t.close or t.bid or t.ask
                    if px and px == px and float(px) > 0:
                        by_sym[sym] = float(px)
                    try:
                        ib.cancelMktData(t.contract)
                    except Exception:
                        pass
                for r in rows:
                    if not r.get("market_price") and r["symbol"] in by_sym:
                        r["market_price"] = by_sym[r["symbol"]]
                        r["price_from"] = "ib_mkt_data"
            except Exception as exc:
                errors.append(f"市价快照部分失败: {exc}")
                logger.info("IB mkt data fill failed: %s", exc)

        for r in rows:
            if r.get("market_price") and r.get("price_from") == "none":
                r["price_from"] = "ib_portfolio"
            if not r.get("market_price"):
                r["price_from"] = "none"

        priced = sum(1 for r in rows if r.get("market_price"))
        return {
            "ok": True,
            "host": host,
            "port": port,
            "client_id": cid,
            "positions": rows,
            "count": len(rows),
            "priced_count": priced,
            "errors": errors,
            "price_source_summary": f"{priced}/{len(rows)} 只有 IB 市价",
        }
    finally:
        try:
            if ib.isConnected():
                ib.disconnect()
        except Exception:
            pass


def fetch_ib_positions(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    client_id: int = DEFAULT_CLIENT_ID,
) -> Dict[str, Any]:
    """从 IB Gateway 拉取持仓（独立线程 + 独立事件循环，兼容 FastAPI）。"""
    box: Dict[str, Any] = {}

    def worker() -> None:
        # 所有 ib_insync 相关 import / 调用必须在本线程内，并先装好 event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            try:
                import ib_insync  # noqa: F401
            except ImportError as exc:
                box["error_msg"] = f"未安装 ib_insync，请 pip install ib_insync ({exc})"
                return
            box["result"] = _fetch_ib_positions_impl(host, port, client_id)
        except Exception as exc:
            box["error_msg"] = str(exc)
            logger.exception("IB fetch failed")
        finally:
            try:
                pending = asyncio.all_tasks(loop)
                for task in pending:
                    task.cancel()
            except Exception:
                pass
            try:
                loop.close()
            except Exception:
                pass
            try:
                asyncio.set_event_loop(None)
            except Exception:
                pass

    t = threading.Thread(target=worker, name="ib-sync", daemon=True)
    t.start()
    t.join(timeout=60)
    if t.is_alive():
        raise RuntimeError("连接盈透超时（60s），请检查 Gateway 是否卡住或端口是否正确")
    if box.get("error_msg"):
        raise RuntimeError(box["error_msg"])
    return box.get("result") or {"ok": False, "positions": [], "message": "无结果"}
def _pnl_adjustment_from_ib(
    qty: float,
    cost: float,
    ib_unrealized: Optional[float],
    ib_market_price: Optional[float],
    symbol: str,
) -> Optional[float]:
    """用盈透未实现盈亏反推固定修正额（相对「数量×(现价−成本)」）。

    adj = IB_unrealized − (标记市价×数量 − 成本×数量)
    这样手续费等差额进 pnl_adjustment，成本价不动；后续现价变动仍正常反映在盈亏里。
    """
    if ib_unrealized is None:
        return None
    q = abs(float(qty))
    c = float(cost or 0)
    if q <= 0:
        return None

    mark = None
    if ib_market_price is not None and float(ib_market_price) > 0:
        mark = float(ib_market_price)
    else:
        # 无 IB 市价时，用看板行情估一刀，尽量对齐当前展示
        try:
            from . import quotes as quote_service

            qq = quote_service.fetch_quote("us", symbol)
            px = qq.get("price")
            if px is not None and float(px) > 0:
                mark = float(px)
        except Exception:
            mark = None

    if mark is None:
        # 没有可对标市价时，无法拆出「价差 vs 手续费」，暂不写修正
        return None

    theoretical = q * mark - q * c
    return float(ib_unrealized) - theoretical


def sync_to_portfolio(
    db,
    portfolio,
    Holding,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    client_id: int = DEFAULT_CLIENT_ID,
    replace: bool = False,
) -> Dict[str, Any]:
    """把 IB 美股持仓写入指定组合，并用 IB 未实现盈亏写入 pnl_adjustment。"""
    if portfolio.market != "us":
        raise ValueError("只能同步到美股组合")

    data = fetch_ib_positions(host=host, port=port, client_id=client_id)
    positions = data.get("positions") or []
    if not positions:
        return {
            **data,
            "synced": 0,
            "created": 0,
            "updated": 0,
            "pnl_adjusted": 0,
            "message": "盈透中没有可同步的美股/ETF 持仓",
        }

    if replace:
        db.query(Holding).filter(
            Holding.portfolio_id == portfolio.id,
            Holding.asset_type.in_(["stock", "etf"]),
        ).delete(synchronize_session=False)
        db.flush()

    created = 0
    updated = 0
    pnl_adjusted = 0
    max_order = db.query(Holding).filter(Holding.portfolio_id == portfolio.id).count()

    for p in positions:
        symbol = p["symbol"]
        qty = abs(float(p["quantity"]))
        avg = float(p["avg_cost"] or 0)
        if avg < 0:
            avg = abs(avg)
        name = p.get("name") or symbol
        asset_type = "etf" if (p.get("sec_type") or "").upper() == "ETF" else "stock"

        existing = (
            db.query(Holding)
            .filter(Holding.portfolio_id == portfolio.id, Holding.symbol == symbol)
            .first()
        )
        # 最终写入的成本（avg 无效时保留旧成本）
        if avg > 0:
            cost_price = avg
        elif existing is not None:
            cost_price = float(existing.cost_price or 0)
        else:
            cost_price = 0.0

        adj = _pnl_adjustment_from_ib(
            qty=qty,
            cost=cost_price,
            ib_unrealized=p.get("unrealized_pnl"),
            ib_market_price=p.get("market_price"),
            symbol=symbol,
        )
        # 保留到返回结果，便于前端/调试
        p["pnl_adjustment"] = adj

        if existing:
            existing.quantity = qty
            existing.cost_price = cost_price
            existing.name = name or existing.name
            existing.currency = "USD"
            existing.asset_type = asset_type
            if adj is not None:
                existing.pnl_adjustment = adj
                pnl_adjusted += 1
            updated += 1
        else:
            max_order += 1
            db.add(
                Holding(
                    portfolio_id=portfolio.id,
                    asset_type=asset_type,
                    symbol=symbol,
                    name=name,
                    currency="USD",
                    quantity=qty,
                    cost_price=cost_price,
                    pnl_adjustment=float(adj or 0.0),
                    sort_order=max_order,
                )
            )
            if adj is not None:
                pnl_adjusted += 1
            created += 1

    db.commit()
    return {
        **data,
        "synced": created + updated,
        "created": created,
        "updated": updated,
        "pnl_adjusted": pnl_adjusted,
        "message": (
            f"已同步 {created + updated} 只（新增 {created}，更新 {updated}）；"
            f"其中 {pnl_adjusted} 只用盈透浮动盈亏写入修正"
        ),
    }
