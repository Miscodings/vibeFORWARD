"""
Registry of active Detector instances.
Agent 0 appends new threshold detectors here at runtime.
"""
from __future__ import annotations
from .base import Detector
from .a2a_transfer import A2ATransferDetector
from .structuring import StructuringDetector
from .mule_fanin import MuleFanInDetector

_DETECTORS: list[Detector] = [
    A2ATransferDetector(),
    StructuringDetector(),
    MuleFanInDetector(),
]


def get_detectors() -> list[Detector]:
    return list(_DETECTORS)


def append_detector(detector: Detector) -> None:
    """Agent 0 calls this to register a newly discovered pattern detector."""
    for existing in _DETECTORS:
        if existing.name == detector.name:
            return   # deduplicate
    _DETECTORS.append(detector)


def update_detector_config(detector_name: str, patch: dict) -> dict | None:
    """Apply a config patch to a named detector; return {old, new} or None."""
    for det in _DETECTORS:
        if det.name == detector_name:
            old = dict(det.config)
            det.config.update(patch)
            return {"old": old, "new": dict(det.config)}
    return None
