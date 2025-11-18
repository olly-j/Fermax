"""Optional camera entity for Fermax Blue."""

from __future__ import annotations

from homeassistant.components.camera import Camera
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    data = hass.data[DOMAIN][entry.entry_id]
    coordinator = data["coordinator"]
    bridge = coordinator.bridge

    camera = FermaxDoorCamera(bridge)
    async_add_entities([camera])


class FermaxDoorCamera(Camera):
    """Simple snapshot camera that delegates URLs to the core library."""

    def __init__(self, bridge) -> None:
        super().__init__()
        self._bridge = bridge
        self._attr_name = "Fermax Door"

    async def async_camera_image(self, width=None, height=None):
        url = await self.hass.async_add_executor_job(
            self._bridge.client.get_snapshot_url, self._bridge.device
        )
        if not url:
            return None
        session = self.hass.helpers.aiohttp_client.async_get_clientsession()
        async with session.get(url) as resp:
            return await resp.read()

