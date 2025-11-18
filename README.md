## Fermax Blue Bridge

This repo hosts the work-in-progress Fermax Blue Bridge stack:

- `fermax_blue/`: Core Python client library that wraps the Fermax Blue / DuoxMe cloud API (auth, discovery, history polling, door control, optional video URLs).
- `custom_components/fermax_blue/`: Home Assistant custom integration built on the core library.
- Optional Homebridge plugin (spec only for now) that can reuse the same core library.

### High-level goals

1. HomeKit doorbell notifications when the Fermax handset button is pressed.
2. Two-way audio/video and unlock control surfaced in Apple Home via HA’s HomeKit Bridge.
3. Door strike control (“unlock”) exposed in software only—no extra hardware.

See `docs/` for architecture, API references, and integration guides (coming soon).

