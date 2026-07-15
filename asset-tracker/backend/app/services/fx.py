"""汇率服务：Frankfurter（ECB 数据，免费免 Key）。

文档: https://api.frankfurter.dev/
支持 USD / CNY / HKD 互转（经美元交叉）。
"""

from __future__ import annotations

import time
from typing import Any, Dict, Union

import httpx

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
_CACHE: dict[str, Any] = {"rates": None, "date": None, "ts": 0.0}
_CACHE_TTL = 60 * 60  # 1 hour


def get_rates(force: bool = False) -> dict:
    """返回以 USD 为基准的汇率：1 USD = rates[ccy]。"""
    now = time.time()
    if (
        not force
        and _CACHE["rates"] is not None
        and now - _CACHE["ts"] < _CACHE_TTL
    ):
        rates = _CACHE["rates"]
        return {
            "usd_cny": rates["CNY"],
            "usd_hkd": rates["HKD"],
            "rates": rates,
            "date": _CACHE["date"],
            "source": "Frankfurter/ECB",
            "cached": True,
        }

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(
                FRANKFURTER_URL,
                params={"from": "USD", "to": "CNY,HKD"},
            )
            resp.raise_for_status()
            data = resp.json()
        cny = float(data["rates"]["CNY"])
        hkd = float(data["rates"]["HKD"])
        rates = {"USD": 1.0, "CNY": cny, "HKD": hkd}
        date = data.get("date")
        _CACHE.update({"rates": rates, "date": date, "ts": now})
        return {
            "usd_cny": cny,
            "usd_hkd": hkd,
            "rates": rates,
            "date": date,
            "source": "Frankfurter/ECB",
            "cached": False,
        }
    except Exception as exc:
        if _CACHE["rates"] is not None:
            rates = _CACHE["rates"]
            return {
                "usd_cny": rates["CNY"],
                "usd_hkd": rates["HKD"],
                "rates": rates,
                "date": _CACHE["date"],
                "source": "Frankfurter/ECB(缓存)",
                "cached": True,
                "error": str(exc),
            }
        raise RuntimeError(f"汇率获取失败: {exc}") from exc


def get_usd_cny_rate(force: bool = False) -> dict:
    """兼容旧接口：1 USD 对应多少 CNY。"""
    data = get_rates(force=force)
    return {
        "rate": data["usd_cny"],
        "usd_hkd": data["usd_hkd"],
        "rates": data["rates"],
        "date": data["date"],
        "source": data["source"],
        "cached": data.get("cached", False),
        "error": data.get("error"),
    }


def convert(
    amount: float,
    from_currency: str,
    to_currency: str,
    rates_or_usd_cny: Union[float, Dict[str, float]],
) -> float:
    """换算金额。

    rates_or_usd_cny: 可为完整 rates 字典 {USD,CNY,HKD}，
    或仅 float（旧用法，当作 USD→CNY，HKD 用近似 7.8）。
    """
    if from_currency == to_currency:
        return amount

    if isinstance(rates_or_usd_cny, dict):
        rates = rates_or_usd_cny
    else:
        usd_cny = float(rates_or_usd_cny)
        rates = {"USD": 1.0, "CNY": usd_cny, "HKD": 7.8}

    for c in (from_currency, to_currency):
        if c not in rates:
            raise ValueError(f"不支持的币种: {c}")

    # 先换成 USD，再换成目标币
    in_usd = amount / rates[from_currency]
    return in_usd * rates[to_currency]
