"""
Fermax Blue Bridge core package.

Contains the HTTP client (`FermaxClient`) and higher-level orchestration layer
(`FermaxBlueBridge`) used by downstream integrations (Home Assistant, HomeKit,
Homebridge, etc.).
"""

from .client import FermaxClient  # noqa: F401
from .bridge import FermaxBlueBridge  # noqa: F401

__all__ = ["FermaxClient", "FermaxBlueBridge"]

