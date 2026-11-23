"""Database access.

Two ways to talk to Postgres:

* user_transaction(): for API requests. Inside the transaction we switch to the
  `authenticated` role and hand Postgres the caller's verified token claims.
  Row Level Security then applies exactly as it does for the app, so even a
  bug in an API query can't read someone else's private rows. This is
  "defense in depth": the API checks permissions, and so does the database.

* pool.connection() directly: for the worker, which needs to see every job and
  so uses the connection's own privileged role (RLS is bypassed).
"""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from dailyfitted_api.auth import AuthUser


def create_pool(database_url: str, *, min_size: int, max_size: int) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        database_url,
        min_size=min_size,
        max_size=max_size,
        open=False,  # opened explicitly at app startup
        kwargs={
            "row_factory": dict_row,
            # Supabase's connection pooler doesn't support prepared statements.
            "prepare_threshold": None,
        },
    )


@asynccontextmanager
async def user_transaction(pool: AsyncConnectionPool, user: AuthUser) -> AsyncIterator[AsyncConnection]:
    async with pool.connection() as conn, conn.transaction():
        # SET LOCAL / set_config(..., true) last only until this transaction
        # ends, so the pooled connection is clean for the next request.
        await conn.execute("set local role authenticated")
        await conn.execute(
            "select set_config('request.jwt.claims', %s, true)",
            [json.dumps(user.claims)],
        )
        yield conn
