"""行情服务：优先 stock-api（腾讯→新浪→东财自动兜底），失败再回退。"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx

from . import market_hours

logger = logging.getLogger(__name__)

# 可选 akshare 兜底（较慢/不稳，仅最后使用）
try:
    import akshare as ak  # type: ignore
except Exception:  # pragma: no cover
    ak = None  # type: ignore

_quote_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()
# 软过期后仍可先返回旧价（stale-while-revalidate），硬过期才必须重拉
_HARD_TTL_SECONDS = 6 * 3600

_a_name_map: Optional[dict[str, str]] = None
_a_name_ts = 0.0
_A_NAME_TTL = 24 * 3600

_BRIDGE_DIR = Path(__file__).resolve().parents[2] / "quote-bridge"
_BRIDGE_SCRIPT = _BRIDGE_DIR / "fetch.mjs"

_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def _cache_ttl() -> float:
    return float(market_hours.market_status()["cache_ttl_seconds"])


def _cache_key(market: str, symbol: str) -> str:
    return f"{market}:{symbol.upper()}"


def _get_cached(key: str, *, allow_stale: bool = False) -> Optional[dict]:
    with _cache_lock:
        item = _quote_cache.get(key)
        if not item:
            return None
        age = time.time() - item["ts"]
        soft = _cache_ttl()
        if age <= soft:
            return item["data"]
        if allow_stale and age <= _HARD_TTL_SECONDS:
            return item["data"]
        return None


def _set_cached(key: str, data: dict) -> None:
    with _cache_lock:
        _quote_cache[key] = {"ts": time.time(), "data": data}


def clear_cache() -> None:
    """仅标记过期：保留数据作 stale，避免 force 后首屏全空再等 5 秒。"""
    with _cache_lock:
        for item in _quote_cache.values():
            # 推到「软过期、硬未过期」，下一次允许 stale 秒回
            item["ts"] = time.time() - _cache_ttl() - 1


def normalize_symbol(market: str, symbol: str) -> str:
    s = symbol.strip().upper()
    if market == "cn":
        s = s.replace("SH", "").replace("SZ", "").replace(".", "")
        if s.isdigit() and len(s) < 6:
            s = s.zfill(6)
        return s
    if s.startswith("US"):
        s = s[2:]
    return s


def to_stock_api_code(market: str, symbol: str) -> Optional[str]:
    """转为 stock-api 代码：USNVDA / SH600519 / SZ000651。"""
    if market == "cash":
        return None
    sym = normalize_symbol(market, symbol)
    if market == "us":
        if not re.match(r"^[A-Z][A-Z0-9.\-]*$", sym):
            return None
        return f"US{sym}"
    if market == "cn":
        if not re.match(r"^\d{6}$", sym):
            return None
        # 5/6/9 开头偏上交所，其余深交所（含 0/1/2/3）
        prefix = "SH" if sym[0] in "569" else "SZ"
        return f"{prefix}{sym}"
    return None


def from_stock_api_code(code: str) -> tuple[str, str]:
    """返回 (market, symbol)。"""
    c = code.strip().upper()
    if c.startswith("US"):
        return "us", c[2:]
    if c.startswith("SH") or c.startswith("SZ"):
        return "cn", c[2:]
    if c.startswith("HK"):
        return "cn", c  # 本项目暂不支持港股展示
    return "us", c


def _cn_prefixed(symbol: str) -> str:
    if symbol.startswith(("sh", "sz", "SH", "SZ")):
        return symbol.lower()
    if symbol.startswith(("5", "6", "9")):
        return f"sh{symbol}"
    return f"sz{symbol}"


def _looks_like_cn_open_fund(symbol: str) -> bool:
    """启发式：更像场外开放式基金，而非沪深交易所股票/ETF。

    场内常见：6/5/9 开头上交所；0/1/2/3 开头深交所股票/ETF（000-003/300/15x/16x/18x 等）。
    016055 这类 01 开头、且非 000-003 主板风格的 6 位码，多半是公募基金。
    """
    s = normalize_symbol("cn", symbol)
    if not re.match(r"^\d{6}$", s):
        return False
    # 明确场内：上交所股票/债券/ETF、深主板/创业板/场内基金
    if s[0] in "569":
        return False
    if s.startswith(("000", "001", "002", "003", "300", "301")):
        return False
    if s.startswith(("15", "16", "17", "18", "159")):
        return False
    # 其余 0 开头（如 016055、110022、519736）按基金处理
    return s[0] == "0" or s[0] in "12"


# ---------- 场外基金净值（天天基金 / 东财）----------


def _parse_fundgz_payload(text: str) -> Optional[dict]:
    """解析 fundgz.1234567.com.cn 返回的 jsonpgz({...});"""
    text = (text or "").strip()
    if not text or "jsonpgz" not in text:
        return None
    m = re.search(r"jsonpgz\(\s*(\{.*\})\s*\)\s*;?", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def _fetch_cn_fund_quote(symbol: str) -> dict:
    """拉取公募基金净值。

    与券商 App 一致：优先「单位净值 dwjz」算市值/盈亏；
    仅当单位净值缺失时才回退到估算净值 gsz。
    """
    symbol = normalize_symbol("cn", symbol)
    if not re.match(r"^\d{6}$", symbol):
        raise RuntimeError(f"无效基金代码 {symbol}")
    url = f"https://fundgz.1234567.com.cn/js/{symbol}.js"
    headers = {
        **_HTTP_HEADERS,
        "Referer": "https://fund.eastmoney.com/",
    }
    with httpx.Client(timeout=8.0) as client:
        resp = client.get(url, headers=headers, params={"rt": str(int(time.time()))})
        resp.raise_for_status()
        # 接口偶发返回 HTML 404
        if "jsonpgz" not in resp.text:
            raise RuntimeError(f"基金行情无数据 {symbol}")
        payload = _parse_fundgz_payload(resp.text)
    if not payload:
        raise RuntimeError(f"基金行情解析失败 {symbol}")
    name = str(payload.get("name") or symbol).strip() or symbol
    price = None
    price_key = None
    # 券商持仓市值按已确认单位净值，不用盘中估算
    for key in ("dwjz", "gsz"):
        raw = payload.get(key)
        if raw is None or raw == "":
            continue
        try:
            val = float(raw)
        except (TypeError, ValueError):
            continue
        if val > 0:
            price = val
            price_key = key
            break
    if price is None:
        raise RuntimeError(f"基金无有效净值 {symbol}")
    percent = None
    try:
        if payload.get("gszzl") not in (None, ""):
            percent = float(payload["gszzl"])
    except (TypeError, ValueError):
        percent = None
    # 单位净值日期用 jzrq；估值才用 gztime
    if price_key == "dwjz" and payload.get("jzrq"):
        quote_date = str(payload.get("jzrq"))
    else:
        quote_date = (
            str(payload.get("gztime") or payload.get("jzrq") or "")
            or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )
    return {
        "symbol": symbol,
        "name": name,
        "price": price,
        "currency": "CNY",
        "market": "cn",
        "quote_date": quote_date,
        "source": f"eastmoney-fundgz/{price_key or 'nav'}",
        "percent": percent,
        "asset_kind": "fund",
    }


def _fetch_cn_fund_batch(symbols: list[str]) -> dict[str, dict]:
    if not symbols:
        return {}
    out: dict[str, dict] = {}
    uniq = list(dict.fromkeys(symbols))

    def _one(sym: str) -> tuple[str, Optional[dict]]:
        try:
            return sym, _fetch_cn_fund_quote(sym)
        except Exception as exc:
            logger.info("fund quote %s fail: %s", sym, exc)
            return sym, None

    workers = min(8, max(1, len(uniq)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_one, s) for s in uniq]
        for fut in as_completed(futs):
            sym, data = fut.result()
            if data:
                out[sym] = data
    return out


# ---------- 主路径：stock-api (Node) ----------


def _fetch_stock_api_batch(api_codes: list[str]) -> dict[str, dict]:
    """api_codes: ['USNVDA','SH600519'] → key=market:SYMBOL 的 quote dict。"""
    if not api_codes:
        return {}
    if not _BRIDGE_SCRIPT.exists():
        raise RuntimeError(f"quote-bridge 不存在: {_BRIDGE_SCRIPT}")

    codes_arg = ",".join(api_codes)
    proc = subprocess.run(
        ["node", str(_BRIDGE_SCRIPT), codes_arg],
        cwd=str(_BRIDGE_DIR),
        capture_output=True,
        text=True,
        timeout=25,
    )
    raw = (proc.stdout or "").strip()
    if not raw:
        raise RuntimeError(f"stock-api 无输出: {proc.stderr[:300]}")
    try:
        payload = json.loads(raw.splitlines()[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"stock-api JSON 解析失败: {raw[:200]}") from exc
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or "stock-api 失败")

    out: dict[str, dict] = {}
    for row in payload.get("quotes") or []:
        code = str(row.get("code") or "").upper()
        price = row.get("price")
        if not code or price is None:
            continue
        try:
            price_f = float(price)
        except (TypeError, ValueError):
            continue
        if price_f <= 0:
            continue
        market, symbol = from_stock_api_code(code)
        if market not in ("us", "cn"):
            continue
        key = _cache_key(market, symbol)
        currency = "USD" if market == "us" else "CNY"
        data = {
            "symbol": symbol,
            "name": row.get("name") or symbol,
            "price": price_f,
            "currency": currency,
            "market": market,
            "quote_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": f"stock-api/{row.get('source') or 'auto'}",
            "percent": row.get("percent"),
        }
        out[key] = data
        _set_cached(key, data)
    return out


# ---------- 回退：新浪 A 股 / Yahoo 美股 / akshare ----------


def _fetch_cn_sina_batch(symbols: list[str]) -> dict[str, dict]:
    if not symbols:
        return {}
    codes = [_cn_prefixed(s) for s in symbols]
    url = "https://hq.sinajs.cn/list=" + ",".join(codes)
    headers = {**_HTTP_HEADERS, "Referer": "https://finance.sina.com.cn"}
    out: dict[str, dict] = {}
    with httpx.Client(timeout=8.0) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        text = resp.text
    for line in text.splitlines():
        m = re.match(r'var hq_str_(sh|sz)(\d{6})="(.*)";?', line.strip())
        if not m:
            continue
        code = m.group(2)
        payload = m.group(3)
        if not payload:
            continue
        parts = payload.split(",")
        if len(parts) < 4:
            continue
        name = parts[0]
        try:
            price = float(parts[3])
        except ValueError:
            continue
        if price <= 0:
            try:
                price = float(parts[2])
            except ValueError:
                continue
        out[code] = {
            "symbol": code,
            "name": name,
            "price": price,
            "currency": "CNY",
            "market": "cn",
            "quote_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": "sina-realtime",
        }
    return out


def _us_clock_session(now=None) -> str:
    """按美东时钟粗分：pre / regular / post / closed。"""
    from datetime import time as dtime

    try:
        from zoneinfo import ZoneInfo

        et = ZoneInfo("America/New_York")
    except Exception:  # pragma: no cover
        et = None
    if now is None:
        now = datetime.now(et) if et else datetime.utcnow()
    elif et is not None:
        if now.tzinfo is None:
            now = now.replace(tzinfo=et)
        else:
            now = now.astimezone(et)
    # 周末
    if now.weekday() >= 5:
        return "closed"
    t = now.time()
    if dtime(4, 0) <= t < dtime(9, 30):
        return "pre"
    if dtime(9, 30) <= t < dtime(16, 0):
        return "regular"
    if dtime(16, 0) <= t <= dtime(20, 0):
        return "post"
    return "closed"


def _session_from_sina_ext_time(label: str) -> str:
    """解析新浪扩展时段时间，如 'Jul 10 08:01PM EDT'。"""
    s = (label or "").strip()
    if not s:
        return "post"
    s = s.replace(" EDT", "").replace(" EST", "").strip()
    for fmt in ("%b %d %I:%M%p", "%b %d %I:%M %p"):
        try:
            dt = datetime.strptime(s, fmt)
            minutes = dt.hour * 60 + dt.minute
            if minutes < 9 * 60 + 30:
                return "pre"
            if minutes >= 16 * 60:
                return "post"
            return "regular"
        except ValueError:
            continue
    return "post"


def _fetch_us_sina_batch(symbols: list[str]) -> dict[str, dict]:
    """新浪美股批量：含盘前/盘后价（field21）与正规盘价（field1）。

    字段约定（hq_str_gb_xxx）：
      [1]  正规盘最新/收盘
      [21] 盘前或盘后最新（有成交时）
      [22] 扩展时段涨跌额
      [23] 扩展时段涨跌幅%
      [24] 扩展时段时间（如 Jul 10 08:01PM EDT）
      [25] 正规盘收盘时间
      [26] 昨收
    """
    if not symbols:
        return {}
    uniq = list(dict.fromkeys(normalize_symbol("us", s) for s in symbols))
    codes = [f"gb_{s.lower()}" for s in uniq]
    url = "https://hq.sinajs.cn/list=" + ",".join(codes)
    headers = {**_HTTP_HEADERS, "Referer": "https://finance.sina.com.cn"}
    out: dict[str, dict] = {}
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        text = resp.content.decode("gbk", errors="replace")

    clock = _us_clock_session()
    for line in text.splitlines():
        m = re.match(
            r'var hq_str_gb_([a-z0-9.\-]+)\s*=\s*"(.*)";?',
            line.strip(),
            re.I,
        )
        if not m:
            continue
        symbol = m.group(1).upper()
        payload = m.group(2)
        if not payload:
            continue
        parts = payload.split(",")
        if len(parts) < 2:
            continue
        name = parts[0] or symbol
        try:
            regular = float(parts[1]) if parts[1] not in ("", "--") else None
        except ValueError:
            regular = None
        ext = None
        if len(parts) > 21 and parts[21] not in ("", "--", "0", "0.00"):
            try:
                ext = float(parts[21])
                if ext <= 0:
                    ext = None
            except ValueError:
                ext = None
        ext_time = parts[24] if len(parts) > 24 else ""
        prev = None
        if len(parts) > 26 and parts[26] not in ("", "--"):
            try:
                prev = float(parts[26])
            except ValueError:
                prev = None

        # 选价：盘前/盘后/休市优先扩展价；盘中用正规盘
        session = "regular"
        price = regular
        if clock == "regular":
            price = regular if regular and regular > 0 else ext
            session = "regular"
        elif clock in ("pre", "post"):
            if ext and ext > 0:
                price = ext
                session = clock
            else:
                price = regular
                session = clock if price else "regular"
        else:
            # 休市：有扩展价用扩展（通常为上一交易日盘后），并标盘后/盘前
            if ext and ext > 0:
                price = ext
                session = _session_from_sina_ext_time(ext_time)
            elif regular and regular > 0:
                price = regular
                session = "regular"

        if price is None or price <= 0:
            continue

        percent = None
        try:
            if prev and prev > 0:
                percent = (price - prev) / prev * 100.0
            elif len(parts) > 2 and parts[2] not in ("", "--"):
                # field2 多为正规盘涨跌幅%
                percent = float(parts[2])
        except (TypeError, ValueError):
            percent = None

        quote_date = ext_time or (parts[3] if len(parts) > 3 else "") or datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        out[symbol] = {
            "symbol": symbol,
            "name": name,
            "price": float(price),
            "currency": "USD",
            "market": "us",
            "quote_date": quote_date,
            "source": f"sina-us/{session}",
            "percent": percent,
            "session": session,
            "regular_price": float(regular) if regular and regular > 0 else None,
        }
    return out


def _us_session_from_ts(ts: int, periods: dict) -> str:
    """根据 K 线时间戳判断盘前 / 常规 / 盘后。"""
    try:
        pre = periods.get("pre") or {}
        reg = periods.get("regular") or {}
        post = periods.get("post") or {}
        pre_start = int(pre.get("start") or 0)
        reg_start = int(reg.get("start") or 0)
        reg_end = int(reg.get("end") or 0)
        post_end = int(post.get("end") or 0)
    except (TypeError, ValueError):
        return "regular"
    if reg_start and reg_end and reg_start <= ts < reg_end:
        return "regular"
    if pre_start and reg_start and pre_start <= ts < reg_start:
        return "pre"
    if reg_end and post_end and reg_end <= ts <= post_end:
        return "post"
    if reg_end and ts >= reg_end:
        return "post"
    if reg_start and ts < reg_start:
        return "pre"
    return "regular"


def _fetch_us_yahoo(symbol: str) -> dict:
    """美股 Yahoo 行情：优先最新扩展时段价（盘前/盘后），否则常规收盘价。"""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        "interval": "1m",
        "range": "1d",
        "includePrePost": "true",
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url, params=params, headers=_HTTP_HEADERS)
        resp.raise_for_status()
        data = resp.json()
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        raise RuntimeError("Yahoo 无数据")
    block = result[0]
    meta = block.get("meta") or {}
    periods = meta.get("currentTradingPeriod") or {}
    regular = meta.get("regularMarketPrice") or meta.get("previousClose")
    timestamps = block.get("timestamp") or []
    closes = ((block.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []

    last_px = None
    last_ts = None
    for ts, close in zip(reversed(timestamps), reversed(closes)):
        if close is None:
            continue
        try:
            px = float(close)
            tsi = int(ts)
        except (TypeError, ValueError):
            continue
        if px > 0:
            last_px = px
            last_ts = tsi
            break

    session = "regular"
    price = None
    if last_px is not None and last_ts is not None:
        session = _us_session_from_ts(last_ts, periods)
        if session in ("pre", "post"):
            price = last_px
        else:
            try:
                price = float(regular) if regular is not None else last_px
            except (TypeError, ValueError):
                price = last_px
    elif regular is not None:
        try:
            price = float(regular)
        except (TypeError, ValueError):
            price = None
        session = "regular"

    if price is None or price <= 0:
        raise RuntimeError("Yahoo 无现价")

    name = meta.get("longName") or meta.get("shortName") or meta.get("symbol") or symbol
    if last_ts:
        quote_date = datetime.utcfromtimestamp(last_ts).strftime("%Y-%m-%d %H:%M:%S UTC")
    else:
        quote_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    percent = None
    prev = meta.get("previousClose") or meta.get("chartPreviousClose")
    try:
        prev_f = float(prev) if prev is not None else None
        if prev_f and prev_f > 0:
            percent = (float(price) - prev_f) / prev_f * 100.0
    except (TypeError, ValueError):
        percent = None

    return {
        "symbol": symbol,
        "name": name,
        "price": float(price),
        "currency": "USD",
        "market": "us",
        "quote_date": quote_date,
        "source": f"yahoo-chart/{session}",
        "percent": percent,
        "session": session,
        "regular_price": float(regular) if regular is not None else None,
    }


def _enrich_us_extended(result: dict[str, dict], us_items: list[tuple[str, str]]) -> None:
    """用新浪（主）/ Yahoo（备）覆盖美股盘前盘后价。us_items: (key, symbol)。"""
    if not us_items:
        return
    symbols = [s for _, s in us_items]
    key_by_sym = {s: k for k, s in us_items}

    # 1) 新浪批量（稳、不易 429）
    try:
        sina = _fetch_us_sina_batch(symbols)
    except Exception as exc:
        logger.info("sina us batch fail: %s", exc)
        sina = {}

    missing: list[tuple[str, str]] = []
    ok = 0
    for sym in symbols:
        key = key_by_sym[sym]
        data = sina.get(sym)
        if not data:
            missing.append((key, sym))
            continue
        base = result.get(key) or {}
        name = base.get("name") or data.get("name")
        # 保留中文名
        if (
            data.get("name")
            and str(data["name"]).isascii()
            and base.get("name")
            and not str(base.get("name")).isascii()
        ):
            name = base["name"]
        merged = {**base, **data, "name": name or data.get("name") or sym}
        result[key] = merged
        _set_cached(key, merged)
        ok += 1
    if ok:
        logger.info("sina us extended ok %s/%s", ok, len(us_items))

    # 2) 缺失的再用 Yahoo（可能 429）
    if not missing:
        return

    def _one(item: tuple[str, str]) -> tuple[str, Optional[dict]]:
        key, sym = item
        try:
            return key, _fetch_us_yahoo(sym)
        except Exception as exc:
            logger.info("yahoo extended %s fail: %s", sym, exc)
            return key, None

    workers = min(6, max(1, len(missing)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_one, it) for it in missing]
        yok = 0
        for fut in as_completed(futs):
            key, data = fut.result()
            if not data:
                continue
            base = result.get(key) or {}
            name = base.get("name") or data.get("name")
            if (
                data.get("name")
                and str(data["name"]).isascii()
                and base.get("name")
                and not str(base.get("name")).isascii()
            ):
                name = base["name"]
            merged = {**base, **data, "name": name or data.get("name") or base.get("symbol")}
            result[key] = merged
            _set_cached(key, merged)
            yok += 1
        if yok:
            logger.info("yahoo extended hours ok %s/%s", yok, len(missing))


def _fetch_cn_akshare(symbol: str) -> dict:
    if ak is None:
        raise RuntimeError("akshare 未安装")
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=40)).strftime("%Y%m%d")
    prefixed = _cn_prefixed(symbol)
    df = ak.stock_zh_a_daily(
        symbol=prefixed, start_date=start, end_date=end, adjust=""
    )
    if df is None or df.empty:
        raise RuntimeError("空数据")
    row = df.iloc[-1]
    return {
        "symbol": symbol,
        "name": symbol,
        "price": float(row["close"]),
        "currency": "CNY",
        "market": "cn",
        "quote_date": str(row["date"])[:10],
        "source": "akshare/sina-daily",
    }


def _fetch_us_akshare(symbol: str) -> dict:
    if ak is None:
        raise RuntimeError("akshare 未安装")
    df = ak.stock_us_daily(symbol=symbol, adjust="")
    if df is None or df.empty:
        raise RuntimeError("空数据")
    row = df.iloc[-1]
    d = row["date"]
    quote_date = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]
    return {
        "symbol": symbol,
        "name": symbol,
        "price": float(row["close"]),
        "currency": "USD",
        "market": "us",
        "quote_date": quote_date,
        "source": "akshare/us-daily",
    }


def fetch_cn_quote(symbol: str) -> dict:
    symbol = normalize_symbol("cn", symbol)
    key = _cache_key("cn", symbol)
    cached = _get_cached(key)
    if cached:
        return cached
    batch = fetch_quotes_batch([("cn", symbol)])
    if key in batch and "error" not in batch[key]:
        return batch[key]
    raise RuntimeError(batch.get(key, {}).get("error") or f"A 股行情失败 {symbol}")


def fetch_us_quote(symbol: str) -> dict:
    symbol = normalize_symbol("us", symbol)
    key = _cache_key("us", symbol)
    cached = _get_cached(key)
    if cached:
        return cached
    batch = fetch_quotes_batch([("us", symbol)])
    if key in batch and "error" not in batch[key]:
        return batch[key]
    raise RuntimeError(batch.get(key, {}).get("error") or f"美股行情失败 {symbol}")


def fetch_quote(market: str, symbol: str) -> dict:
    if market == "cn":
        return fetch_cn_quote(symbol)
    if market == "us":
        return fetch_us_quote(symbol)
    raise ValueError(f"不支持的市场: {market}")


def _refresh_quotes_blocking(pending: list[tuple[str, str, str]], result: dict[str, dict]) -> None:
    """真正去外站拉价。pending: (key, market, symbol)。优先 HTTP 批量，慢源最后。"""
    if not pending:
        return

    # 0) 场外基金 / 美股新浪 / A 股新浪 并行
    fund_items = [(k, m, s) for k, m, s in pending if m == "cn" and _looks_like_cn_open_fund(s)]
    us_items = [(k, m, s) for k, m, s in pending if m == "us"]
    cn_stock = [
        (k, m, s)
        for k, m, s in pending
        if m == "cn" and not _looks_like_cn_open_fund(s)
    ]

    def _funds() -> None:
        if not fund_items:
            return
        try:
            got = _fetch_cn_fund_batch([s for _, _, s in fund_items])
            for key, _m, sym in fund_items:
                if sym in got:
                    _set_cached(key, got[sym])
                    result[key] = got[sym]
            logger.info("fundgz ok %s/%s", len(got), len(fund_items))
        except Exception as exc:
            logger.info("fundgz fail: %s", exc)

    def _us() -> None:
        if not us_items:
            return
        try:
            _enrich_us_extended(result, [(k, s) for k, _m, s in us_items])
        except Exception as exc:
            logger.info("us sina fail: %s", exc)

    def _cn_sina() -> None:
        if not cn_stock:
            return
        try:
            sina = _fetch_cn_sina_batch([s for _, _, s in cn_stock])
            for key, _m, sym in cn_stock:
                if sym in sina:
                    _set_cached(key, sina[sym])
                    result[key] = sina[sym]
            logger.info("sina cn ok %s/%s", len(sina), len(cn_stock))
        except Exception as exc:
            logger.info("sina cn fail: %s", exc)

    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = [pool.submit(_funds), pool.submit(_us), pool.submit(_cn_sina)]
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as exc:
                logger.info("parallel quote worker: %s", exc)

    # 1) 仍缺：stock-api（Node，较慢，只补缺）
    missing = [(k, m, s) for k, m, s in pending if k not in result]
    api_codes = []
    code_to_key: dict[str, str] = {}
    for key, market, sym in missing:
        code = to_stock_api_code(market, sym)
        if code:
            api_codes.append(code)
            code_to_key[code] = key
    if api_codes:
        try:
            got = _fetch_stock_api_batch(api_codes)
            for key, data in got.items():
                result[key] = data
            logger.info("stock-api ok %s/%s", len(got), len(api_codes))
        except Exception as exc:
            logger.warning("stock-api failed: %s", exc)

    # 美股若只有 stock-api 正规盘价，再补扩展时段
    us_need = [(k, s) for k, m, s in pending if m == "us" and k in result]
    # 已 enrich 过则 source 含 sina-us；否则再试一次
    us_need = [
        (k, s)
        for k, s in us_need
        if not str((result.get(k) or {}).get("source") or "").startswith("sina-us")
        and not str((result.get(k) or {}).get("source") or "").startswith("yahoo-chart")
    ]
    if us_need:
        try:
            _enrich_us_extended(result, us_need)
        except Exception as exc:
            logger.info("us enrich 2nd fail: %s", exc)

    # 2) 仍缺：基金 / yahoo / akshare
    still = [(k, m, s) for k, m, s in pending if k not in result]
    still_cn = [(k, m, s) for k, m, s in still if m == "cn"]
    if still_cn:
        try:
            got = _fetch_cn_fund_batch([s for _, _, s in still_cn])
            for key, _m, sym in still_cn:
                if sym in got:
                    _set_cached(key, got[sym])
                    result[key] = got[sym]
        except Exception as exc:
            logger.info("fund fallback fail: %s", exc)

    still = [(k, m, s) for k, m, s in still if k not in result]

    def _one(item: tuple[str, str, str]) -> tuple[str, dict]:
        key, market, sym = item
        try:
            if market == "us":
                try:
                    data = _fetch_us_yahoo(sym)
                except Exception:
                    data = _fetch_us_akshare(sym)
            else:
                try:
                    data = _fetch_cn_akshare(sym)
                except Exception:
                    data = _fetch_cn_fund_quote(sym)
            _set_cached(key, data)
            return key, data
        except Exception as exc:
            return key, {"symbol": sym, "market": market, "error": str(exc)}

    if still:
        workers = min(12, max(1, len(still)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [pool.submit(_one, item) for item in still]
            for fut in as_completed(futs):
                key, data = fut.result()
                result[key] = data


def fetch_quotes_batch(items: list[tuple[str, str]]) -> dict[str, dict]:
    """items: (market, symbol)。

    - 软缓存命中：直接返回
    - 软过期但硬未过期：先返回旧价，后台刷新（首屏秒开）
    - 完全没有：阻塞拉取
    """
    result: dict[str, dict] = {}
    if not items:
        return result

    uniq: dict[str, tuple[str, str]] = {}
    for market, symbol in items:
        if market == "cash":
            continue
        sym = normalize_symbol(market, symbol)
        key = _cache_key(market, sym)
        uniq[key] = (market, sym)

    must_fetch: list[tuple[str, str, str]] = []
    bg_refresh: list[tuple[str, str, str]] = []

    for key, (market, sym) in uniq.items():
        fresh = _get_cached(key, allow_stale=False)
        if fresh:
            result[key] = fresh
            continue
        stale = _get_cached(key, allow_stale=True)
        if stale:
            result[key] = stale
            bg_refresh.append((key, market, sym))
        else:
            must_fetch.append((key, market, sym))

    if must_fetch:
        _refresh_quotes_blocking(must_fetch, result)

    if bg_refresh:
        # 后台刷新，不挡本次响应
        def _bg() -> None:
            try:
                tmp: dict[str, dict] = {}
                _refresh_quotes_blocking(bg_refresh, tmp)
            except Exception as exc:
                logger.info("bg quote refresh fail: %s", exc)

        threading.Thread(target=_bg, name="quote-bg", daemon=True).start()

    return result
