"""Optional button entity to trigger door open."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
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

    async_add_entities([FermaxOpenDoorButton(bridge)])


class FermaxOpenDoorButton(ButtonEntity):
    """Calls the Fermax open door action when pressed."""

    _attr_has_entity_name = True
    _attr_name = "Open Door"

    def __init__(self, bridge) -> None:
        self._bridge = bridge

    async def async_press(self) -> None:
        await self.hass.async_add_executor_job(
            self._bridge.client.open_door, self._bridge.device
        )

