"""Low-level HTTP client for Fermax Blue / DuoxMe cloud."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote

import requests
import os

from .exceptions import ApiError, AuthenticationError, DeviceNotFoundError
from .types import Device, HistoryEvent

COMMON_HEADERS = {
    "app-version": "3.3.2",
    "accept-language": "en-ES;q=1.0, es-ES;q=0.9",
    "phone-os": "17.0",
    "user-agent": "Blue/3.3.2 (com.fermax.bluefermax; build:3; iOS 17.0.0) Alamofire/5.6.4",
    "phone-model": "iPhone15,4",
    "app-build": "3",
}

AUTH_URL = "https://oauth-pro-duoxme.fermax.io/oauth/token"
API_BASE = "https://pro-duoxme.fermax.io"
BLUE_BASE = "https://blue.fermax.io"
OAUTH_BASIC = "ZHB2N2lxejZlZTVtYXptMWlxOWR3MWQ0MnNseXV0NDhrajBtcDVmdm81OGo1aWg6Yzd5bGtxcHVqd2FoODV5aG5wcnYwd2R2eXp1dGxjbmt3NHN6OTBidWxkYnVsazE="


class FermaxClient:
    """Wrap Fermax Blue REST calls with token caching."""

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
        self._token_expiry: Optional[datetime] = None
        self._token_cache.parent.mkdir(parents=True, exist_ok=True)

    # --------------------------------------------------------------------- auth
    def authenticate(self, force: bool = False) -> str:
        """Return a valid OAuth token."""

        if not force and self._access_token and self._token_expiry:
            if datetime.now(timezone.utc) < self._token_expiry - timedelta(minutes=1):
                return self._access_token

        cached = self._load_cached_token()
        if cached and not force:
            return cached

        payload = f"grant_type=password&username={quote(self._username)}&password={quote(self._password)}"
        headers = {
            "Authorization": f"Basic {OAUTH_BASIC}",
            "Content-Type": "application/x-www-form-urlencoded",
            **COMMON_HEADERS,
        }
        response = self._session.post(AUTH_URL, data=payload, headers=headers, timeout=15)
        if response.status_code != 200:
            raise AuthenticationError(f"Fermax login failed: {response.text}")

        data = response.json()
        self._access_token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        self._token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        self._persist_token(self._access_token, self._token_expiry)
        return self._access_token

    def _load_cached_token(self) -> Optional[str]:
        try:
            with self._token_cache.open("r", encoding="utf-8") as handle:
                cached = json.load(handle)
        except FileNotFoundError:
            return None

        token = cached.get("token")
        expires_at = cached.get("expires_at")
        if not token or not expires_at:
            return None

        expiry = datetime.fromisoformat(expires_at)
        if datetime.now(timezone.utc) >= expiry - timedelta(minutes=1):
            return None

        self._access_token = token
        self._token_expiry = expiry
        return token

    def _persist_token(self, token: str, expires_at: datetime) -> None:
        data = {"token": token, "expires_at": expires_at.isoformat()}
        with self._token_cache.open("w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.chmod(self._token_cache, 0o600)

    def _request(
        self,
        method: str,
        path: str,
        *,
        base: str = API_BASE,
        **kwargs,
    ) -> requests.Response:
        token = self.authenticate()
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", f"Bearer {token}")
        headers.update(COMMON_HEADERS)

        url = f"{base}{path}"
        response = self._session.request(method, url, headers=headers, timeout=15, **kwargs)
        if response.status_code >= 400:
            raise ApiError(f"Fermax API error ({response.status_code}): {response.text}")
        return response

    # --------------------------------------------------------------- discovery
    def get_user_info(self) -> Dict:
        """Return Fermax account metadata."""

        response = self._request("GET", "/user/api/v1/users/me")
        return response.json()

    def get_devices(self) -> List[Device]:
        """Return monitors and visible doors."""

        response = self._request("GET", "/pairing/api/v3/pairings/me")
        payload = response.json()
        devices: List[Device] = []

        for pairing in payload:
            tag = pairing.get("tag") or "Fermax Monitor"
            root_device = Device(
                device_id=pairing["deviceId"],
                name=tag,
                type="monitor",
            )
            devices.append(root_device)

            for info in pairing.get("accessDoorMap", {}).values():
                if not info.get("visible", True):
                    continue
                devices.append(
                    Device(
                        device_id=pairing["deviceId"],
                        name=info.get("title") or f"{tag} Door",
                        type="door",
                        access_id=info.get("accessId"),
                    )
                )

        return devices

    # ----------------------------------------------------------------- control
    def open_door(self, device: Device, access_override: Optional[Dict[str, int]] = None) -> bool:
        """Trigger the door strike associated with `device`."""

        if device.type == "door":
            if not device.access_id:
                raise DeviceNotFoundError("Door device missing access_id payload")
            payload = device.access_id
            device_id = device.device_id
        else:
            if not access_override:
                raise DeviceNotFoundError("Monitor device requires explicit access payload")
            payload = access_override
            device_id = device.device_id

        response = self._request(
            "POST",
            f"/deviceaction/api/v1/device/{device_id}/directed-opendoor",
            json=payload,
        )
        return response.status_code == 200

    # ---------------------------------------------------------------- history
    def get_history(self, device: Device, limit: int = 10) -> List[HistoryEvent]:
        """Return the latest history entries for a device."""

        params = {"callRegistryType": "all", "deviceId": device.device_id}
        response = self._request(
            "GET",
            "/callManager/api/v1/callregistry/participant",
            base=BLUE_BASE,
            params=params,
        )
        history = []
        for item in response.json()[:limit]:
            history.append(self._to_history_event(item))
        return history

    def _to_history_event(self, payload: Dict) -> HistoryEvent:
        event_id = str(payload.get("id") or payload.get("callId") or payload.get("callDate"))
        event_type = payload.get("eventType") or payload.get("callRegistryType") or "call"
        timestamp = payload.get("callDate") or payload.get("createdAt")
        answered = payload.get("answered") or payload.get("attended") or False
        started_at = self._parse_datetime(timestamp)
        return HistoryEvent(
            event_id=event_id,
            event_type=event_type,
            started_at=started_at,
            answered=bool(answered),
            raw=payload,
        )

    @staticmethod
    def _parse_datetime(value: Optional[str]) -> datetime:
        if not value:
            return datetime.now(timezone.utc)
        try:
            if value.endswith("Z"):
                value = value.replace("Z", "+00:00")
            return datetime.fromisoformat(value)
        except ValueError:
            return datetime.now(timezone.utc)

    # ----------------------------------------------------------- optional video
    def get_snapshot_url(self, device: Device) -> Optional[str]:
        """Return a short-lived snapshot URL if Fermax API exposes it."""
        # The Blue cloud currently returns inline base64 rather than expirable URLs.
        return None

    def get_stream_url(self, device: Device) -> Optional[str]:
        """Return a streaming URL (RTSP/HTTPS) if Fermax API exposes it."""
        return None

