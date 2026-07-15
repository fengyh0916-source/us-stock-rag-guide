from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field

Market = Literal["us", "cn", "cash"]
AssetType = Literal["stock", "etf", "fund", "cash"]
# 汇总切换仅 USD/CNY；持仓原币可含 HKD（现金）
DisplayCurrency = Literal["USD", "CNY"]
HoldingCurrency = Literal["USD", "CNY", "HKD"]


class PortfolioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    market: Market


class PortfolioUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=20)


class PortfolioOut(BaseModel):
    id: int
    name: str
    market: Market
    sort_order: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class HoldingCreate(BaseModel):
    portfolio_id: int
    asset_type: AssetType = "stock"
    symbol: str = Field(default="", max_length=32)
    name: str = Field(default="", max_length=64)
    quantity: float = Field(gt=0)
    cost_price: float = Field(default=1.0, ge=0)
    currency: Optional[HoldingCurrency] = None


class HoldingUpdate(BaseModel):
    asset_type: Optional[AssetType] = None
    name: Optional[str] = Field(default=None, max_length=64)
    quantity: Optional[float] = Field(default=None, gt=0)
    cost_price: Optional[float] = Field(default=None, ge=0)
    currency: Optional[HoldingCurrency] = None
    # 固定盈亏修正（元），不改成本价；例如券商含手续费后与「市值-成本」的差额
    pnl_adjustment: Optional[float] = None


class HoldingOut(BaseModel):
    id: int
    portfolio_id: int
    asset_type: AssetType
    symbol: str
    name: str
    quantity: float
    cost_price: float
    market: Market
    currency: HoldingCurrency
    sort_order: int = 0
    pnl_adjustment: float = 0.0
    price: Optional[float] = None
    # 美股价时段：pre 盘前 / regular 常规 / post 盘后（A 股通常为空）
    price_session: Optional[str] = None
    market_value: Optional[float] = None
    cost_value: Optional[float] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    weight: Optional[float] = None
    quote_date: Optional[str] = None
    quote_error: Optional[str] = None

    class Config:
        from_attributes = True


class PortfolioSummary(BaseModel):
    id: Union[int, str]
    name: str
    market: Optional[Market] = None
    sort_order: int = 0
    market_value: float
    cost_value: float
    pnl: float
    pnl_pct: Optional[float]
    holding_count: int


class ReorderBody(BaseModel):
    ids: list[int] = Field(min_length=1)


class DashboardOut(BaseModel):
    display_currency: DisplayCurrency
    fx_rate: float
    fx_date: Optional[str]
    fx_source: str
    total_market_value: float
    total_cost_value: float
    total_pnl: float
    total_pnl_pct: Optional[float]
    portfolios: list[PortfolioSummary]
    holdings: list[HoldingOut]
    updated_at: str
    cn_open: bool = False
    us_open: bool = False
    any_open: bool = False
    poll_seconds: int = 1
