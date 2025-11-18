"""Config flow for Fermax Blue."""

from __future__ import annotations

from typing import Any, Dict, Optional

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant

from fermax_blue import FermaxClient

from .const import DOMAIN


async def validate_input(hass: HomeAssistant, data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate user credentials by logging in."""

    def _validate() -> None:
        client = FermaxClient(data["username"], data["password"])
        client.authenticate()
        client.get_devices()

    await hass.async_add_executor_job(_validate)

    return {
        "title": "Fermax Blue",
        "username": data["username"],
    }


class FermaxConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Fermax Blue."""

    VERSION = 1

    async def async_step_user(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> config_entries.FlowResult:
        errors = {}

        if user_input:
            try:
                info = await validate_input(self.hass, user_input)
            except Exception:
                errors["base"] = "auth"
            else:
                await self.async_set_unique_id(user_input["username"])
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=info["title"], data=user_input)

        data_schema = vol.Schema(
            {
                vol.Required("username"): str,
                vol.Required("password"): str,
                vol.Optional("poll_interval", default=10): int,
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=data_schema,
            errors=errors,
        )

