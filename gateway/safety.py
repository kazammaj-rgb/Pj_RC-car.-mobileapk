from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


@dataclass
class SafetyState:
    emergency_locked: bool = False
    heartbeat_ok: bool = False
    last_heartbeat: Optional[datetime] = None
    connection_ok: bool = False
    last_error: str = 'No errors'
    rearmed: bool = True
    stop_requested: bool = False

    def set_emergency_lock(self, value: bool) -> None:
        self.emergency_locked = value
        self.rearmed = not value
        self.stop_requested = value

    def set_heartbeat(self, ok: bool) -> None:
        self.heartbeat_ok = ok
        self.last_heartbeat = datetime.now(timezone.utc)

    def require_rearm(self) -> None:
        self.emergency_locked = True
        self.rearmed = False
        self.stop_requested = True

    def mark_rearm(self) -> None:
        self.emergency_locked = False
        self.rearmed = True
        self.stop_requested = False

    def to_dict(self) -> dict:
        return {
            'emergency_locked': self.emergency_locked,
            'heartbeat_ok': self.heartbeat_ok,
            'last_heartbeat': self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            'connection_ok': self.connection_ok,
            'last_error': self.last_error,
            'rearmed': self.rearmed,
            'stop_requested': self.stop_requested,
        }
