"""The Postgres-backed job queue.

How claiming works (the key idea):

    SELECT ... FOR UPDATE SKIP LOCKED

FOR UPDATE locks the job row we pick. SKIP LOCKED tells other workers running
the same query at the same moment to skip rows that are already locked
instead of waiting for them. So N workers can poll together and each gets a
different job, with no double-processing and no extra queue service.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from dailyfitted_api.worker.detector import DetectedItem


@dataclass(frozen=True)
class Job:
    id: int
    outfit_id: UUID
    photo_path: str
    attempts: int  # including this one
    max_attempts: int


class JobQueue(Protocol):
    async def claim(self) -> Job | None: ...

    async def succeed(self, job: Job, items: list[DetectedItem]) -> None: ...

    async def retry_later(self, job: Job, error: str, run_after: datetime) -> None: ...

    async def give_up(self, job: Job, error: str) -> None: ...


_CLAIM_SQL = """
with next_job as (
    select j.id
    from public.detection_jobs j
    where (j.status = 'queued' and j.run_after <= now())
       -- A job stuck in "running" means its worker died mid-job. Retry it.
       or (j.status = 'running' and j.locked_at < now() - make_interval(secs => %(stale_seconds)s))
    order by j.run_after
    limit 1
    for update skip locked
)
update public.detection_jobs j
set status = 'running',
    locked_at = now(),
    attempts = j.attempts + 1,
    updated_at = now()
from next_job, public.outfits o
where j.id = next_job.id
  and o.id = j.outfit_id
returning j.id, j.outfit_id, o.photo_path, j.attempts, j.max_attempts
"""


class PostgresJobQueue:
    """Uses the pool's own (privileged) role: the worker must see every job."""

    def __init__(self, pool: AsyncConnectionPool, *, stale_after_seconds: int) -> None:
        self._pool = pool
        self._stale_seconds = stale_after_seconds

    async def claim(self) -> Job | None:
        # Claiming is its own short transaction. The slow detection call runs
        # *after* it commits, so we never hold a lock during a network call.
        async with (
            self._pool.connection() as conn,
            conn.transaction(),
            conn.cursor(row_factory=dict_row) as cur,
        ):
            await cur.execute(_CLAIM_SQL, {"stale_seconds": self._stale_seconds})
            row = await cur.fetchone()
        if row is None:
            return None
        return Job(**row)

    async def succeed(self, job: Job, items: list[DetectedItem]) -> None:
        # Saving suggested items lands in Phase 4 (items/outfit_items tables).
        await self._finish(job, "succeeded", None)

    async def retry_later(self, job: Job, error: str, run_after: datetime) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                """
                update public.detection_jobs
                set status = 'queued', run_after = %s, locked_at = null,
                    last_error = %s, updated_at = now()
                where id = %s
                """,
                [run_after, error, job.id],
            )

    async def give_up(self, job: Job, error: str) -> None:
        await self._finish(job, "failed", error)

    async def _finish(self, job: Job, status: str, error: str | None) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                """
                update public.detection_jobs
                set status = %s, locked_at = null, last_error = %s, updated_at = now()
                where id = %s
                """,
                [status, error, job.id],
            )
