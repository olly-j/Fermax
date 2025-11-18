"""Dataclasses and typing helpers for Fermax Blue models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

DeviceType = Literal["monitor", "door"]


@dataclass(slots=True)
class Device:
    """Represents a Fermax Blue device (monitor or door)."""

    device_id: str
    name: str
    type: DeviceType
    access_id: Optional[str] = None


@dataclass(slots=True)
class HistoryEvent:
    """History/log entry reported by Fermax Blue."""

    event_id: str
    event_type: str
    started_at: datetime
    answered: bool
    raw: dict

