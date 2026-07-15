import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "portfolio.db"

_raw_url = os.getenv("DATABASE_URL", "").strip()
if _raw_url.startswith("postgres://"):
    _raw_url = _raw_url.replace("postgres://", "postgresql://", 1)

if _raw_url:
    DATABASE_URL = _raw_url
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )
    USING_SQLITE = False
else:
    DATABASE_URL = f"sqlite:///{DB_PATH}"
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
    USING_SQLITE = True

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _add_column_if_missing(conn, table: str, column: str, ddl: str) -> None:
    cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    names = {row[1] for row in cols}
    if column not in names:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
        conn.commit()


def ensure_schema() -> None:
    """创建表并迁移旧库字段。"""
    Base.metadata.create_all(bind=engine)
    try:
        with engine.connect() as conn:
            if USING_SQLITE:
                _add_column_if_missing(
                    conn, "holdings", "currency", "currency VARCHAR(8) NOT NULL DEFAULT 'CNY'"
                )
                _add_column_if_missing(
                    conn, "holdings", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0"
                )
                _add_column_if_missing(
                    conn,
                    "holdings",
                    "pnl_adjustment",
                    "pnl_adjustment FLOAT NOT NULL DEFAULT 0",
                )
                _add_column_if_missing(
                    conn, "portfolios", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0"
                )
                _add_column_if_missing(
                    conn, "portfolios", "user_id", "user_id VARCHAR(64) NOT NULL DEFAULT ''"
                )
            else:
                # Postgres: ignore if exists
                for stmt in [
                    "ALTER TABLE holdings ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'CNY'",
                    "ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE holdings ADD COLUMN IF NOT EXISTS pnl_adjustment DOUBLE PRECISION NOT NULL DEFAULT 0",
                    "ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NOT NULL DEFAULT ''",
                ]:
                    try:
                        conn.execute(text(stmt))
                        conn.commit()
                    except Exception:
                        conn.rollback()

            try:
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_portfolios_user_id ON portfolios (user_id)"
                    )
                )
                conn.commit()
            except Exception:
                conn.rollback()

            # 股票/ETF 币种按组合市场强制纠正（现金保留自身 currency）
            conn.execute(
                text(
                    """
                    UPDATE holdings
                    SET currency = 'USD'
                    WHERE asset_type != 'cash'
                      AND portfolio_id IN (SELECT id FROM portfolios WHERE market = 'us')
                    """
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE holdings
                    SET currency = 'CNY'
                    WHERE asset_type != 'cash'
                      AND portfolio_id IN (SELECT id FROM portfolios WHERE market = 'cn')
                    """
                )
            )
            conn.commit()

            # 仅在「全部为 0」时按 id 初始化排序，避免覆盖用户拖拽结果
            p_max = conn.execute(text("SELECT COALESCE(MAX(sort_order), 0) FROM portfolios")).scalar()
            if p_max == 0:
                conn.execute(text("UPDATE portfolios SET sort_order = id"))
            h_max = conn.execute(text("SELECT COALESCE(MAX(sort_order), 0) FROM holdings")).scalar()
            if h_max == 0:
                conn.execute(text("UPDATE holdings SET sort_order = id"))
            conn.commit()
    except Exception:
        pass
