"""Item detection.

Detector is an interface so the vision model can be swapped without touching
the worker. Phase 2 compares real models on 50 photos; until then the stub
finds nothing, and outfits simply have no suggested tags (tagging is optional).
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class BoundingBox:
    # Fractions of the image size (0 to 1), so they don't depend on resolution.
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class DetectedItem:
    type: str  # e.g. "jacket"
    color: str | None
    possible_brand: str | None
    confidence: float
    box: BoundingBox


class Detector(Protocol):
    async def detect(self, photo_path: str) -> list[DetectedItem]: ...


class StubDetector:
    """Placeholder until a vision model is chosen in Phase 2."""

    async def detect(self, photo_path: str) -> list[DetectedItem]:
        return []
