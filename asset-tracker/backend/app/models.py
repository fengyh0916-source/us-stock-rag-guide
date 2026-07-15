from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 所属用户（与网站登录 session.sub 一致）；隔离多用户资产
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    name: Mapped[str] = mapped_column(String(20), nullable=False)
    market: Mapped[str] = mapped_column(String(10), nullable=False)  # us | cn | cash
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    holdings: Mapped[list["Holding"]] = relationship(
        "Holding", back_populates="portfolio", cascade="all, delete-orphan"
    )


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("portfolio_id", "symbol", name="uq_portfolio_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"))
    asset_type: Mapped[str] = mapped_column(String(10), nullable=False)  # stock | etf | fund | cash
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="CNY")  # USD | CNY
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    cost_price: Mapped[float] = mapped_column(Float, nullable=False)
    # 相对「市值-成本」的固定盈亏修正（手续费等），成本价不变
    pnl_adjustment: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    portfolio: Mapped["Portfolio"] = relationship("Portfolio", back_populates="holdings")
