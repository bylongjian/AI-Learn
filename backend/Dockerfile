# syntax=docker/dockerfile:1

# Build from backend/; dependency layers are reused when only app code changes.
FROM python:3.11-slim-bookworm AS dependencies

ARG PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build

COPY requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir \
        --index-url "${PIP_INDEX_URL}" -r requirements.txt \
    && /opt/venv/bin/python -m pip check

FROM python:3.11-slim-bookworm AS runtime

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    APP_ENV=production \
    DEV_LOGIN_ENABLED=false \
    PORT=80

# HTTPS certificates and the OpenMP runtime used by native vector dependencies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dependencies /opt/venv /opt/venv
COPY app/ ./app/
COPY sql/ ./sql/
COPY scripts/init_db.py ./scripts/init_db.py
RUN mkdir -p /app/data/chroma /app/data/uploads

# The console's listening port must match PORT (80 by default).
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '80') + '/api/v1/health', timeout=3).close()"]

# exec forwards termination to Uvicorn so FastAPI can release background resources.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-80}\" --workers 1"]
