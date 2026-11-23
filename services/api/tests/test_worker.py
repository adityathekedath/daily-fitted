import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from dailyfitted_api.worker.detector import DetectedItem, StubDetector
from dailyfitted_api.worker.queue import Job
from dailyfitted_api.worker.retry import GiveUp, RetryLater, after_failure, backoff_delay
from dailyfitted_api.worker.run import process_one

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=UTC)


# --- retry rules ---------------------------------------------------------------


def test_backoff_doubles_then_caps() -> None:
    assert [backoff_delay(n).total_seconds() for n in range(1, 5)] == [30, 60, 120, 240]
    assert backoff_delay(50) == timedelta(hours=1)


def test_backoff_rejects_attempt_zero() -> None:
    with pytest.raises(ValueError):
        backoff_delay(0)


def test_retries_until_max_attempts_then_gives_up() -> None:
    assert after_failure(attempts=1, max_attempts=3, now=NOW) == RetryLater(NOW + timedelta(seconds=30))
    assert after_failure(attempts=2, max_attempts=3, now=NOW) == RetryLater(NOW + timedelta(seconds=60))
    assert after_failure(attempts=3, max_attempts=3, now=NOW) == GiveUp()


# --- the worker loop, with a fake queue --------------------------------------------


class FakeQueue:
    def __init__(self, jobs: list[Job]) -> None:
        self.jobs = jobs
        self.succeeded: list[int] = []
        self.retried: list[tuple[int, datetime]] = []
        self.gave_up: list[tuple[int, str]] = []

    async def claim(self) -> Job | None:
        return self.jobs.pop(0) if self.jobs else None

    async def succeed(self, job: Job, items: list[DetectedItem]) -> None:
        self.succeeded.append(job.id)

    async def retry_later(self, job: Job, error: str, run_after: datetime) -> None:
        self.retried.append((job.id, run_after))

    async def give_up(self, job: Job, error: str) -> None:
        self.gave_up.append((job.id, error))


class BrokenDetector:
    async def detect(self, photo_path: str) -> list[DetectedItem]:
        raise TimeoutError("vision API timed out")


def make_job(job_id: int = 1, *, attempts: int = 1, max_attempts: int = 3) -> Job:
    return Job(
        id=job_id, outfit_id=uuid4(), photo_path="u/p.jpg", attempts=attempts, max_attempts=max_attempts
    )


def test_empty_queue_returns_false() -> None:
    assert asyncio.run(process_one(FakeQueue([]), StubDetector())) is False


def test_successful_job() -> None:
    queue = FakeQueue([make_job(7)])
    assert asyncio.run(process_one(queue, StubDetector())) is True
    assert queue.succeeded == [7]


def test_failed_job_is_retried_with_backoff() -> None:
    queue = FakeQueue([make_job(7, attempts=2)])
    asyncio.run(process_one(queue, BrokenDetector(), now=lambda: NOW))
    assert queue.retried == [(7, NOW + timedelta(seconds=60))]
    assert queue.succeeded == []


def test_job_on_its_last_attempt_is_given_up() -> None:
    queue = FakeQueue([make_job(7, attempts=3, max_attempts=3)])
    asyncio.run(process_one(queue, BrokenDetector(), now=lambda: NOW))
    assert queue.gave_up == [(7, "TimeoutError: vision API timed out")]


def test_job_recovered_past_max_attempts_is_given_up_without_running() -> None:
    queue = FakeQueue([make_job(7, attempts=4, max_attempts=3)])
    asyncio.run(process_one(queue, StubDetector()))
    assert queue.gave_up == [(7, "exceeded max attempts")]
    assert queue.succeeded == []
