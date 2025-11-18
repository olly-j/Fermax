"""Low-level HTTP client for Fermax Blue / DuoxMe cloud."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List, Optional

import requests

from .exceptions import ApiError, AuthenticationError
from .types import Device, HistoryEvent


class FermaxClient:
    """
    Wraps the network calls used by Fermax-Blue-Intercom and bluecon.

    TODO: Port the exact endpoints, payloads, and response parsing logic from
    upstream scripts. For now, this class only defines the public interface we
    expect to consume from higher layers.
    """

    BASE_URL = "https://api.fermaxblue.com"  # Placeholder; confirm via sniffing.

    def __init__(
        self,
        username: str,
        password: str,
        session: Optional[requests.Session] = None,
        token_cache: Optional[Path] = None,
    ) -> None:
        self._username = username
        self._password = password
        self._session = session or requests.Session()
        self._token_cache = token_cache or Path.home() / ".cache/fermax_blue/token.json"
        self._access_token: Optional[str] = None

    # --------------------------------------------------------------------- auth
    def authenticate(self, force: bool = False) -> str:
        """
        Log in and return an access token.

        TODO: cache tokens, respect expiry, implement secure file perms.
        """

        if self._access_token and not force:
            return self._access_token

        raise AuthenticationError("FermaxClient.authenticate not implemented yet")

    # --------------------------------------------------------------- discovery
    def get_user_info(self) -> Dict:
        """Return Fermax account metadata."""
        raise ApiError("FermaxClient.get_user_info not implemented yet")

    def get_devices(self) -> List[Device]:
        """Return monitors/doors paired to the account."""
        raise ApiError("FermaxClient.get_devices not implemented yet")

    # ----------------------------------------------------------------- control
    def open_door(self, device: Device) -> bool:
        """Trigger the door strike associated with `device`."""
        raise ApiError("FermaxClient.open_door not implemented yet")

    # ---------------------------------------------------------------- history
    def get_history(self, device: Device, limit: int = 10) -> List[HistoryEvent]:
        """Return the latest history entries for a device."""
        raise ApiError("FermaxClient.get_history not implemented yet")

    # ----------------------------------------------------------- optional video
    def get_snapshot_url(self, device: Device) -> Optional[str]:
        """Return a short-lived snapshot URL if Fermax API exposes it."""
        return None

    def get_stream_url(self, device: Device) -> Optional[str]:
        """Return a streaming URL (RTSP/HTTPS) if Fermax API exposes it."""
        return None

