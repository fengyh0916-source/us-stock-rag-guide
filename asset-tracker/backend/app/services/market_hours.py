"""交易时段判断（不考虑节假日微调，追求实用与刷新策略）。"""

from __future__ import annotations

from datetime import datetime, time, timezone, timedelta
from typing import Dict
from zoneinfo import ZoneInfo

# Python 3.9: zoneinfo available; macOS may need tzdata
try:
    CN_TZ = ZoneInfo("Asia/Shanghai")
    US_ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    CN_TZ = timezone(timedelta(hours=8))
    US_ET = timezone(timedelta(hours=-5))


def _is_weekday(dt: datetime) -> bool:
    return dt.weekday() < 5


def is_cn_market_open(now=None) -> bool:
    """A 股可刷新窗口：工作日 09:15-11:30、13:00-15:05（北京时间，含集合竞价）。"""
    now = now or datetime.now(CN_TZ)
    if now.tzinfo is None:
        now = now.replace(tzinfo=CN_TZ)
    else:
        now = now.astimezone(CN_TZ)
    if not _is_weekday(now):
        return False
    t = now.time()
    return (time(9, 15) <= t <= time(11, 30)) or (time(13, 0) <= t <= time(15, 5))


def is_us_market_open(now=None) -> bool:
    """美股可刷新：工作日美东 04:00-20:00（盘前+常规+盘后）。"""
    now = now or datetime.now(US_ET)
    if now.tzinfo is None:
        now = now.replace(tzinfo=US_ET)
    else:
        now = now.astimezone(US_ET)
    if not _is_weekday(now):
        return False
    t = now.time()
    return time(4, 0) <= t <= time(20, 0)


def market_status() -> Dict:
    now_utc = datetime.now(timezone.utc)
    cn_open = is_cn_market_open()
    us_open = is_us_market_open()
    any_open = cn_open or us_open

    # 能力范围内最快：始终 1s 一轮。
    # 免费 HTTP 行情源本身延迟/限流在秒级，再压到 <1s 易 429，且单次拉取常要数百毫秒～数秒。
    # 休市也保持 1s（盘后价/基金净值仍可能更新；缓存不复用，避免“假刷新”）。
    poll_seconds = 1
    cache_ttl = 0.0

    return {
        "cn_open": cn_open,
        "us_open": us_open,
        "any_open": any_open,
        "poll_seconds": poll_seconds,
        "cache_ttl_seconds": cache_ttl,
        "server_time": now_utc.isoformat(),
        "cn_time": datetime.now(CN_TZ).isoformat(),
        "us_time": datetime.now(US_ET).isoformat(),
    }
