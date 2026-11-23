"""Settings, read from environment variables (or a local .env file).

pydantic-settings validates them at startup, so a missing DATABASE_URL fails
fast with a clear message instead of crashing on the first request.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres connection string for the Supabase database. Use the "Session
    # pooler" string from the Supabase dashboard (Connect > Session pooler).
    database_url: str

    # e.g. https://abcd1234.supabase.co
    supabase_url: str

    # Only needed for projects that still sign tokens with the legacy shared
    # secret (HS256). Newer projects use asymmetric signing keys, which we
    # fetch from the project's public JWKS endpoint instead.
    supabase_jwt_secret: str | None = None

    # Supabase puts "authenticated" in the `aud` claim of signed-in users' tokens.
    jwt_audience: str = "authenticated"

    db_pool_min_size: int = 1
    db_pool_max_size: int = 10

    # Worker: how long to sleep when the queue is empty, and when a "running"
    # job is considered abandoned (its worker crashed) and can be retried.
    worker_poll_seconds: float = Field(default=2.0, gt=0)
    worker_stale_after_seconds: int = Field(default=600, gt=0)

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.jwt_issuer}/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
