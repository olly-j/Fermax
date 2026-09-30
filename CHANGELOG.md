# Changelog

## 0.2.0-beta.1

Hardware validation is pending. This version is available from GitHub, not npm.

- Add a Home Assistant backend for door release, current ring events, snapshots and video-only cloud preview.
- Reject ambiguous or mismatched entrances and prevent replay of uncertain unlock commands.
- Bound authentication recovery, HTTP/body waits and shutdown cancellation.
- Replace the obsolete push dependency and require complete Firebase configuration for experimental direct alerts.
- Secure and isolate token caches; deduplicate ring events across reconnects.
- Use Homebridge's HAP classes and a DoorbellController; fix camera readiness, UDP reservations, IPv6 and cleanup.
- Refresh dependencies, remove tracked dependency folders and consolidate setup documentation.

## 0.1.2

Previous Homebridge implementation from November 2025, with direct Fermax control, experimental notifications and externally configured camera media. Its readiness claims were not supported by physical acceptance evidence.
