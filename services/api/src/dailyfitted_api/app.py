"""FastAPI application setup."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from dailyfitted_api import outfits
from dailyfitted_api.auth import TokenVerifier
from dailyfitted_api.config import Settings, get_settings
from dailyfitted_api.db import create_pool


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Open the connection pool once at startup and close it on shutdown,
        # instead of connecting on every request.
        pool = create_pool(
            settings.database_url,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
        )
        await pool.open()
        app.state.verifier = TokenVerifier.for_supabase(
            jwks_url=settings.jwks_url,
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            shared_secret=settings.supabase_jwt_secret,
        )
        app.state.outfit_repository = outfits.PostgresOutfitRepository(pool)
        try:
            yield
        finally:
            await pool.close()

    app = FastAPI(title="Daily Fitted API", version="0.1.0", lifespan=lifespan)
    app.include_router(outfits.router)

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
