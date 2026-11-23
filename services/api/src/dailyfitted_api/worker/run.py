"""The worker loop: claim a job, run detection, record the result, repeat."""

import asyncio
import logging
import signal
from collections.abc import Callable
from datetime import UTC, datetime

from dailyfitted_api.config import get_settings
from dailyfitted_api.db import create_pool
from dailyfitted_api.worker.detector import Detector, StubDetector
from dailyfitted_api.worker.queue import JobQueue, PostgresJobQueue
from dailyfitted_api.worker.retry import GiveUp, after_failure

log = logging.getLogger("dailyfitted.worker")


async def process_one(
    queue: JobQueue,
    detector: Detector,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> bool:
    """Process at most one job. Returns False if the queue was empty."""
    job = await queue.claim()
    if job is None:
        return False

    if job.attempts > job.max_attempts:
        # Recovered from a crashed worker after its last allowed try.
        await queue.give_up(job, "exceeded max attempts")
        return True

    try:
        items = await detector.detect(job.photo_path)
    except Exception as exc:  # any failure: decide whether to retry
        error = f"{type(exc).__name__}: {exc}"
        decision = after_failure(attempts=job.attempts, max_attempts=job.max_attempts, now=now())
        if isinstance(decision, GiveUp):
            log.error("job %s failed permanently: %s", job.id, error)
            await queue.give_up(job, error)
        else:
            log.warning("job %s failed (try %s), retrying at %s", job.id, job.attempts, decision.run_after)
            await queue.retry_later(job, error, decision.run_after)
        return True

    await queue.succeed(job, items)
    log.info("job %s done: %d items", job.id, len(items))
    return True


async def run_forever(
    queue: JobQueue, detector: Detector, *, poll_seconds: float, stop: asyncio.Event
) -> None:
    while not stop.is_set():
        try:
            did_work = await process_one(queue, detector)
        except Exception:
            # e.g. the database is briefly unreachable. Log it and keep going.
            log.exception("worker loop error")
            did_work = False
        if not did_work:
            # Queue empty: wait before polling again (or stop early on shutdown).
            try:
                await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
            except TimeoutError:
                pass


async def _main() -> None:
    settings = get_settings()
    pool = create_pool(settings.database_url, min_size=1, max_size=2)
    await pool.open()

    # Finish the current job, then exit cleanly on Ctrl-C or a deploy's SIGTERM.
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    queue = PostgresJobQueue(pool, stale_after_seconds=settings.worker_stale_after_seconds)
    log.info("worker started")
    try:
        await run_forever(queue, StubDetector(), poll_seconds=settings.worker_poll_seconds, stop=stop)
    finally:
        await pool.close()
        log.info("worker stopped")


def main() -> None:
    """Run the worker (used by the `dailyfitted-worker` command)."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(_main())
