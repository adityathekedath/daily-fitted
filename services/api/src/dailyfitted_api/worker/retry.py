"""Retry rules for failed jobs. Pure functions, so they're easy to test."""

from dataclasses import dataclass
from datetime import datetime, timedelta

BASE_DELAY = timedelta(seconds=30)
MAX_DELAY = timedelta(hours=1)


def backoff_delay(attempt: int) -> timedelta:
    """Exponential backoff: 30s, 60s, 120s, ... capped at 1 hour.

    Waiting longer after each failure gives a struggling dependency (like the
    vision API) time to recover instead of hammering it.
    """
    if attempt < 1:
        raise ValueError("attempt starts at 1")
    # Cap the exponent too, so a huge attempt count can't overflow.
    delay: timedelta = BASE_DELAY * (2 ** min(attempt - 1, 20))
    return min(delay, MAX_DELAY)


@dataclass(frozen=True)
class RetryLater:
    run_after: datetime


@dataclass(frozen=True)
class GiveUp:
    pass


def after_failure(*, attempts: int, max_attempts: int, now: datetime) -> RetryLater | GiveUp:
    """What to do with a job that just failed on its `attempts`-th try."""
    if attempts >= max_attempts:
        return GiveUp()
    return RetryLater(run_after=now + backoff_delay(attempts))
