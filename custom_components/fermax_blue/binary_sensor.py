"""Doorbell binary sensor entity."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
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

    sensor = FermaxDoorbellSensor(bridge)
    async_add_entities([sensor])


class FermaxDoorbellSensor(BinarySensorEntity):
    """Simple binary sensor that pulses ON when a ring event occurs."""

    _attr_has_entity_name = True
    _attr_name = "Doorbell"
    _attr_device_class = "occupancy"

    def __init__(self, bridge) -> None:
        self._bridge = bridge
        self._attr_is_on = False
        bridge.on_ring(self._handle_ring)

    def _handle_ring(self, event) -> None:
        self._attr_is_on = True
        self.schedule_update_ha_state()
        if self.hass:
            self.hass.loop.call_later(10, self._reset)

    def _reset(self) -> None:
        self._attr_is_on = False
        self.schedule_update_ha_state()

