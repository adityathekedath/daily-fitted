"""Outfits: models, storage (repository), and HTTP routes.

The routes depend on the OutfitRepository *interface*, not on Postgres
directly. Production uses PostgresOutfitRepository; tests swap in an in-memory
fake, so route logic can be tested without a database.
"""

import re
from datetime import date, datetime
from typing import Annotated, Protocol
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

from dailyfitted_api.auth import AuthUser, CurrentUser
from dailyfitted_api.db import user_transaction

PHOTO_BUCKET = "outfit-photos"

# "<user uuid>/<photo uuid>.jpg", matching what the app uploads.
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
PHOTO_PATH_PATTERN = re.compile(rf"^(?P<owner>{_UUID})/{_UUID}\.jpg$")


class NewOutfit(BaseModel):
    photo_path: str = Field(description="Path inside the outfit-photos bucket")
    caption: str | None = Field(default=None, max_length=280)
    worn_on: date | None = Field(default=None, description="The user's local date; defaults to today")


class Outfit(BaseModel):
    id: UUID
    user_id: UUID
    photo_path: str
    caption: str | None
    worn_on: date
    rank_key: float | None
    created_at: datetime


class PhotoNotFound(Exception):
    pass


class DuplicatePhoto(Exception):
    pass


class OutfitRepository(Protocol):
    async def create(self, user: AuthUser, new: NewOutfit) -> Outfit: ...

    async def list_for_user(self, user: AuthUser, *, limit: int) -> list[Outfit]: ...


class PostgresOutfitRepository:
    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool

    async def create(self, user: AuthUser, new: NewOutfit) -> Outfit:
        async with user_transaction(self._pool, user) as conn:
            # The photo must already be uploaded. This query also runs under
            # RLS, so it only finds files the caller is allowed to see.
            cur = await conn.execute(
                "select 1 from storage.objects where bucket_id = %s and name = %s",
                [PHOTO_BUCKET, new.photo_path],
            )
            if await cur.fetchone() is None:
                raise PhotoNotFound(new.photo_path)

            try:
                cur = await conn.execute(
                    """
                    insert into public.outfits (user_id, photo_path, caption, worn_on)
                    values (%s, %s, %s, coalesce(%s, current_date))
                    returning id, user_id, photo_path, caption, worn_on,
                              rank_key::float8 as rank_key, created_at
                    """,
                    [user.id, new.photo_path, new.caption, new.worn_on],
                )
            except psycopg.errors.UniqueViolation as exc:
                raise DuplicatePhoto(new.photo_path) from exc
            # A database trigger adds the detection job in this same
            # transaction, so an outfit never exists without its job.
            row = await cur.fetchone()
            if row is None:  # INSERT ... RETURNING always returns a row
                raise RuntimeError("insert returned no row")
            return Outfit.model_validate(row)

    async def list_for_user(self, user: AuthUser, *, limit: int) -> list[Outfit]:
        async with user_transaction(self._pool, user) as conn:
            cur = await conn.execute(
                """
                select id, user_id, photo_path, caption, worn_on,
                       rank_key::float8 as rank_key, created_at
                from public.outfits
                where user_id = %s
                order by worn_on desc, created_at desc
                limit %s
                """,
                [user.id, limit],
            )
            return [Outfit.model_validate(row) for row in await cur.fetchall()]


def get_outfit_repository(request: Request) -> OutfitRepository:
    repo: OutfitRepository = request.app.state.outfit_repository
    return repo


Repo = Annotated[OutfitRepository, Depends(get_outfit_repository)]

router = APIRouter(prefix="/outfits", tags=["outfits"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_outfit(new: NewOutfit, user: CurrentUser, repo: Repo) -> Outfit:
    """Post an outfit whose photo the app has already uploaded to storage.

    Returns right away. Item detection runs later in the worker, so posting
    never waits on AI (product rule: never block posting on detection).
    """
    match = PHOTO_PATH_PATTERN.match(new.photo_path)
    if match is None or UUID(match["owner"]) != user.id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "photo_path must be '<your user id>/<uuid>.jpg'",
        )
    try:
        return await repo.create(user, new)
    except PhotoNotFound:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Photo not found. Upload it first."
        ) from None
    except DuplicatePhoto:
        raise HTTPException(status.HTTP_409_CONFLICT, "This photo is already posted") from None


@router.get("/me")
async def list_my_outfits(
    user: CurrentUser, repo: Repo, limit: Annotated[int, Query(ge=1, le=100)] = 50
) -> list[Outfit]:
    """Your outfits, newest first."""
    return await repo.list_for_user(user, limit=limit)
