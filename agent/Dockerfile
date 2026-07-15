FROM python:3.11-slim

WORKDIR /app

# 系统依赖（pymupdf 等）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY frontend /app/frontend
COPY data /app/data

# 构建时入库（无需 API Key）
WORKDIR /app/backend
RUN python scripts/ingest.py

ENV PORT=8000
ENV ENVIRONMENT=production
EXPOSE 8000

# 生产启动
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
