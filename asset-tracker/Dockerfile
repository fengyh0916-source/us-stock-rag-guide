# 可选：Docker 部署后端（Railway / Fly / 任意容器平台）
FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/quote-bridge/package.json backend/quote-bridge/package-lock.json* backend/quote-bridge/
WORKDIR /app/backend/quote-bridge
RUN npm install --omit=dev

WORKDIR /app
COPY backend ./backend
COPY supabase ./supabase

ENV PORT=8000
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
