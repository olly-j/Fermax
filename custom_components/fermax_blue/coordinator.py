"""DataUpdateCoordinator for Fermax Blue."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from fermax_blue import FermaxBlueBridge

from .const import DEFAULT_POLL_INTERVAL, DOMAIN


class FermaxDataUpdateCoordinator(DataUpdateCoordinator[Dict[str, Any]]):
    """Thin wrapper that polls Fermax Blue history."""

    def __init__(self, hass: HomeAssistant, entry_data: Dict[str, Any]) -> None:
        self.bridge = FermaxBlueBridge(
            entry_data["username"],
            entry_data["password"],
            poll_interval=entry_data.get("poll_interval", DEFAULT_POLL_INTERVAL),
        )

        update_interval = timedelta(
            seconds=entry_data.get("poll_interval", DEFAULT_POLL_INTERVAL)
        )

        super().__init__(
            hass,
            logger=hass.helpers.logging.getLogger(__name__),
            name=f"{DOMAIN}_coordinator",
            update_interval=update_interval,
        )

    async def _async_update_data(self) -> Dict[str, Any]:
        try:
            if not self.bridge.device:
                devices = await self.hass.async_add_executor_job(
                    self.bridge.discover_devices
                )
                if not devices:
                    raise UpdateFailed("No Fermax devices discovered")

            history = await self.hass.async_add_executor_job(
                self.bridge.client.get_history, self.bridge.device, 5
            )
            return {"history": history}
        except Exception as exc:
            raise UpdateFailed(str(exc)) from exc

