# One image runs both processes:
#   API:    docker run ... dailyfitted-api
#   Worker: docker run ... dailyfitted-worker
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Install dependencies first (cached unless the lock file changes)...
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

# ...then the app code.
COPY README.md ./
COPY src ./src
RUN uv sync --locked --no-dev

ENV PATH="/app/.venv/bin:$PATH"
# Don't run as root inside the container.
RUN useradd --create-home app
USER app

EXPOSE 8000
CMD ["dailyfitted-api"]
