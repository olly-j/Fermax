# Protocol research

Reviewed 30 September 2026. Upstream implementations establish protocol evidence, not successful operation on this project's hardware.

| Source | Finding | Design consequence |
|---|---|---|
| [bvis/fermax-blue-hass](https://github.com/bvis/fermax-blue-hass/tree/a3f7d959be2bf2be77036c4962b410f5e64a0f1c), version `0.20.5` | Current push handling and Socket.IO/mediasoup/WebRTC media receiver; HA camera output available | Reuse its cloud receiver through HA |
| [cvc90/Fermax-Blue-Intercom](https://github.com/cvc90/Fermax-Blue-Intercom) | OAuth, discovery and directed door-release research | Direct API reference |
| [AfonsoFGarcia/bluecon](https://github.com/AfonsoFGarcia/bluecon) | Call notification and photocaller research | Notification payload and stored-image reference |
| [Eneris/push-receiver](https://github.com/Eneris/push-receiver), `4.4.0` | Maintained Node FCM receiver requires full Firebase client configuration | Replace incompatible sender-only registration; validate Fermax project acceptance separately |
| [homebridge/ffmpeg-for-homebridge](https://github.com/homebridge/ffmpeg-for-homebridge), `2.2.2` | Homebridge FFmpeg distribution | Video transcoding dependency; a system binary can override it |
| [HA HomeKit Bridge](https://www.home-assistant.io/integrations/homekit/) | Alternative publisher with its own event/media configuration | Do not assume placing entities in the same room creates a doorbell |

Current upstream uses `pro-duoxme.fermax.io` and `oauth-pro-duoxme.fermax.io`; legacy reviewed service hosts remain configurable. App OAuth values can change, so use the [official-app extraction procedure](https://github.com/bvis/fermax-blue-hass#api-credentials). A telemetry Basic header is not an OAuth credential.

The previous plugin's `register(senderId)` call did not match its installed push library. Its static RTSP/HLS examples also did not implement Fermax cloud call negotiation. Repairing those assumptions, rather than accepting the old production-ready claims, motivated this beta.

Dependencies are MIT licensed and pinned at the direct-package level; the lockfile records the development dependency graph. Review upstream changes, project restrictions and advisories before updating. Removing the HA backend returns to direct control with an external media source; replacing the push receiver requires registration and reconnect contract tests. No third-party agent catalog or installer is part of the plugin.
