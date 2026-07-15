from functools import lru_cache
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py → 项目根目录 agent/
PROJECT_ROOT = Path(__file__).resolve().parents[2]
# 网站根目录（content/posts 与 agent 同级）
SITE_ROOT = PROJECT_ROOT.parent
DATA_DIR = PROJECT_ROOT / "data"
PDF_PATH = DATA_DIR / "中国人投资美股指南.pdf"
POSTS_DIR = SITE_ROOT / "content" / "posts"
INDEX_DIR = DATA_DIR / "index"
CHUNKS_PATH = INDEX_DIR / "chunks.json"
FRONTEND_DIR = PROJECT_ROOT / "frontend"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(SITE_ROOT / ".env.local"),
            str(SITE_ROOT / ".env"),
            str(PROJECT_ROOT / ".env"),
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_base_url: str = "https://api.deepseek.com"
    port: int = 8000
    rate_limit_per_minute: int = 20
    top_k: int = 5
    # 当前产品策略：宽泛问题也直接给概览答案，不再发起固定追问。
    enable_clarification: bool = False
    # DeepSeek V4 默认可能开 thinking；问答场景关闭更省钱、更快
    enable_thinking: bool = False
    # 逗号分隔；空则开发环境允许 *，生产请配置为站点域名
    allowed_origins: str = ""
    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def cors_origins() -> list[str]:
    settings = get_settings()
    raw = (settings.allowed_origins or "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    if is_production():
        raise RuntimeError("生产环境必须配置 ALLOWED_ORIGINS，禁止使用通配符跨域")
    return ["*"]


def is_production() -> bool:
    settings = get_settings()
    return settings.environment.strip().lower() in {"production", "prod"} or bool(
        os.getenv("RENDER")
    )


def validate_production_settings() -> None:
    if not is_production():
        return
    settings = get_settings()
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("生产环境必须配置 DEEPSEEK_API_KEY")
    cors_origins()
