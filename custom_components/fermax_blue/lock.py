"""Fermax door lock entity."""

from __future__ import annotations

from homeassistant.components.lock import LockEntity
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

    lock = FermaxDoorLock(bridge)
    async_add_entities([lock])


class FermaxDoorLock(LockEntity):
    """Maps unlock command to Fermax door open action."""

    _attr_has_entity_name = True
    _attr_name = "Door"
    _attr_is_locked = True

    def __init__(self, bridge) -> None:
        self._bridge = bridge

    async def async_unlock(self, **kwargs):
        success = await self.hass.async_add_executor_job(self._bridge.client.open_door, self._bridge.device)  # type: ignore[arg-type]
        if success:
            self._attr_is_locked = False
            self.async_write_ha_state()

    async def async_lock(self, **kwargs):
        self._attr_is_locked = True
        self.async_write_ha_state()

