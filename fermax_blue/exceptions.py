"""Custom exception hierarchy for Fermax Blue interactions."""


class FermaxError(Exception):
    """Base error for Fermax Blue operations."""


class AuthenticationError(FermaxError):
    """Failed to authenticate with Fermax Blue."""


class ApiError(FermaxError):
    """Fermax Blue returned an unexpected response."""


class DeviceNotFoundError(FermaxError):
    """Requested device/access pair could not be located."""

