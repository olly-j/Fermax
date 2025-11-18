"""High-level polling/event bridge built on top of FermaxClient."""

from __future__ import annotations

import threading
import time
from typing import Callable, Dict, Iterable, List, Optional

from .client import FermaxClient
from .types import Device, HistoryEvent

RingCallback = Callable[[HistoryEvent], None]


class FermaxBlueBridge:
    """Coordinates device selection, history polling, and callbacks."""

    def __init__(
        self,
        username: str,
        password: str,
        poll_interval: float = 10.0,
        client: Optional[FermaxClient] = None,
    ) -> None:
        self.client = client or FermaxClient(username, password)
        self.poll_interval = poll_interval
        self.device: Optional[Device] = None

        self._ring_callbacks: List[RingCallback] = []
        self._last_event_id: Optional[str] = None
        self._poll_thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    # ---------------------------------------------------------- device helpers
    def discover_devices(self) -> List[Device]:
        devices = self.client.get_devices()
        if devices:
            self.device = devices[0]
        return devices

    def set_active_device(self, device: Device) -> None:
        self.device = device

    # --------------------------------------------------------------- callbacks
    def on_ring(self, callback: RingCallback) -> None:
        self._ring_callbacks.append(callback)

    # ------------------------------------------------------------- polling loop
    def start_polling(self) -> None:
        if self._poll_thread and self._poll_thread.is_alive():
            return

        self._stop.clear()
        self._poll_thread = threading.Thread(
            target=self._poll_loop, name="FermaxBlueBridgePoll", daemon=True
        )
        self._poll_thread.start()

    def stop_polling(self) -> None:
        self._stop.set()
        if self._poll_thread:
            self._poll_thread.join(timeout=self.poll_interval * 2)

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            if not self.device:
                time.sleep(self.poll_interval)
                continue

            try:
                history = self.client.get_history(self.device, limit=3)
            except Exception:
                time.sleep(self.poll_interval)
                continue

            self._handle_history(history)
            time.sleep(self.poll_interval)

    def _handle_history(self, history: Iterable[HistoryEvent]) -> None:
        for event in history:
            if event.event_id == self._last_event_id:
                break

            self._last_event_id = event.event_id
            if event.event_type.lower() in {"call", "ring", "incoming"}:
                for callback in self._ring_callbacks:
                    callback(event)

