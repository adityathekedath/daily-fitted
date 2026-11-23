"""Shared test helpers: signed test tokens and an in-memory outfit store."""

import time
from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dailyfitted_api.app import create_app
from dailyfitted_api.auth import AuthUser, TokenVerifier
from dailyfitted_api.config import Settings
from dailyfitted_api.outfits import DuplicatePhoto, NewOutfit, Outfit, PhotoNotFound

SUPABASE_URL = "https://test-project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
SECRET = "test-secret-that-is-long-enough-for-hs256-signing"


def make_token(
    user_id: UUID,
    *,
    secret: str = SECRET,
    issuer: str = ISSUER,
    audience: str = "authenticated",
    expires_in: int = 3600,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "aud": audience,
        "iss": issuer,
        "role": "authenticated",
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


class FakeOutfitRepository:
    """Behaves like the Postgres repository, minus the database."""

    def __init__(self) -> None:
        self.outfits: list[Outfit] = []
        self.uploaded_photos: set[str] = set()

    async def create(self, user: AuthUser, new: NewOutfit) -> Outfit:
        if new.photo_path not in self.uploaded_photos:
            raise PhotoNotFound(new.photo_path)
        if any(o.photo_path == new.photo_path for o in self.outfits):
            raise DuplicatePhoto(new.photo_path)
        outfit = Outfit(
            id=uuid4(),
            user_id=user.id,
            photo_path=new.photo_path,
            caption=new.caption,
            worn_on=new.worn_on or date.today(),
            rank_key=None,
            created_at=datetime.now(UTC),
        )
        self.outfits.append(outfit)
        return outfit

    async def list_for_user(self, user: AuthUser, *, limit: int) -> list[Outfit]:
        mine = [o for o in self.outfits if o.user_id == user.id]
        return sorted(mine, key=lambda o: (o.worn_on, o.created_at), reverse=True)[:limit]


@pytest.fixture
def repo() -> FakeOutfitRepository:
    return FakeOutfitRepository()


@pytest.fixture
def app(repo: FakeOutfitRepository) -> FastAPI:
    settings = Settings(database_url="postgresql://unused", supabase_url=SUPABASE_URL)
    app = create_app(settings)
    # Not using `with TestClient(app)`, so the lifespan (which opens a real
    # database pool) doesn't run. We set the state it would have set instead.
    app.state.verifier = TokenVerifier(
        issuer=ISSUER, audience="authenticated", key_resolver=None, shared_secret=SECRET
    )
    app.state.outfit_repository = repo
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    yield TestClient(app)


@pytest.fixture
def user_id() -> UUID:
    return uuid4()


@pytest.fixture
def auth_headers(user_id: UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}
