<div align="center">

# Fermax Blue for Homebridge

**Bring your Fermax Blue / DuoxMe entrance into Apple Home.**

[![Checks](https://github.com/olly-j/Fermax/actions/workflows/ci.yml/badge.svg)](https://github.com/olly-j/Fermax/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-0.2.0--beta.1-orange)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Install](#install-on-a-homebridge-pi) · [Configure](#configure) · [Troubleshooting](#troubleshooting) · [Development](docs/development.md)

</div>

A Homebridge plugin for Fermax VEO-XS WiFi / DUOX PLUS entrances. Release the door, receive doorbell events, and view supported camera sources from Apple Home.

> [!IMPORTANT]
> **Beta:** automated tests and a local video-stream test pass. Physical Fermax operation and Raspberry Pi performance still need validation. Live cloud video uses Home Assistant; direct Fermax mode does not provide cloud video by itself.

## Choose your connection

| | Direct Fermax | Home Assistant |
|---|---|---|
| Requires | DuoxMe account and app credentials | HA with the [Fermax integration](https://github.com/bvis/fermax-blue-hass) |
| Door release | Fermax cloud API | Selected HA lock |
| Doorbell alerts | Experimental; full Firebase configuration needed | HA doorbell event |
| Snapshots | Stored photocaller image, when available | Selected HA camera |
| Video | Separately verified external stream | Authenticated HA MJPEG preview |

Video is **video only**: no two-way audio or HomeKit Secure Video. The lock display resets on a timer; it does not measure whether the door is shut, and the plugin cannot physically secure it.

## Install on a Homebridge Pi

Requirements: **Node 22, 24 or 26**, **Homebridge 1.11+ or 2.x**, and a paired, working DuoxMe monitor. FFmpeg is installed as a dependency.

1. Download a backup in Homebridge UI.
2. Open **Homebridge UI → Terminal**. For the official Homebridge Raspberry Pi image, run:

   ```sh
   cd /var/lib/homebridge
   npm install --omit=dev --legacy-peer-deps git+https://github.com/olly-j/Fermax.git#main
   ```

3. Restart Homebridge.
4. Open **Plugins → homebridge-fermax-blue → Settings** and choose your connection.

This installs the code from GitHub; the beta is not published to npm. These commands assume the official Pi image's plugin directory. For a custom installation, use that installation's plugin directory. See [Homebridge's installation guidance](https://github.com/homebridge/homebridge/wiki/How-to-Install-Alternate-Plugin-Versions).

To update, repeat the install command and restart. For a reproducible deployment, replace `main` with a reviewed commit SHA. Keep your previous plugin package and configuration backup for rollback.

## Configure

### Homebridge only: direct Fermax

Choose **Direct Fermax** and provide your account, paired device and access door. Use current OAuth client credentials from your official DuoxMe app; the bundled legacy fallback has not been validated against current accounts. See the upstream [credential extraction guide](https://github.com/bvis/fermax-blue-hass#api-credentials).

```json
{
  "platform": "FermaxBluePlatform",
  "name": "Entrance",
  "backend": "direct",
  "username": "dedicated-user@example.com",
  "password": "REPLACE_WITH_PASSWORD",
  "deviceId": "REPLACE_WITH_DEVICE_ID",
  "accessDoorKey": "ZERO",
  "clientId": "REPLACE_WITH_APP_CLIENT_ID",
  "clientSecret": "REPLACE_WITH_APP_CLIENT_SECRET"
}
```

`ZERO` is an example: use your actual door key. Explicit mismatches fail setup. Multiple devices or access doors require an unambiguous selector.

For experimental alerts, also enter `senderId`, `firebaseProjectId`, `firebaseAppId`, `firebaseApiKey`, and `firebaseVapidKey` if required. **Sender ID alone is insufficient.** Firebase project restrictions may reject this client registration.

### Homebridge with Home Assistant: cloud video

First set up and verify the [Fermax integration in Home Assistant](docs/home-assistant.md). Then choose **Home Assistant** in the plugin settings and enter the actual entity IDs and an HA access token:

```json
{
  "platform": "FermaxBluePlatform",
  "name": "Entrance",
  "backend": "homeassistant",
  "homeAssistantUrl": "https://ha.example.com",
  "homeAssistantToken": "REPLACE_WITH_ACCESS_TOKEN",
  "homeAssistantLockEntity": "lock.entrance",
  "homeAssistantRingEntity": "event.entrance_doorbell",
  "homeAssistantCameraEntity": "camera.entrance",
  "homeAssistantPreviewEntity": "button.entrance_camera_preview"
}
```

Use the **doorbell event entity**, not a connectivity sensor. Leave `cameraStreamUrl` blank to use HA's authenticated camera stream. The preview button wakes a receive-only cloud session when Apple Home requests video. Camera and ring fields are optional for door-release-only use.

> [!TIP]
> Use a dedicated invited DuoxMe user. Upstream reports one active push destination per user; sharing your phone's account can disrupt its notifications. Protect Homebridge configuration and backups, which contain plaintext credentials. Prefer HTTPS for HA tokens.

## Troubleshooting

| Problem | Check |
|---|---|
| Plugin does not appear | Required Node/Homebridge versions, correct plugin directory, and restart |
| Authentication fails | Current app OAuth credentials or HA token; the accounts are different |
| Device or door is rejected | Exact pairing ID, tag and door key; the plugin deliberately avoids fallback |
| No alerts | Actual HA doorbell event or all direct Firebase fields; outages can cause missed events |
| No snapshot | HA camera availability or an existing Fermax photocaller image and registered app token |
| No live video | HA preview works independently, entity IDs, FFmpeg installation and Pi CPU usage |
| Unlock times out | Check the physical door before retrying; ambiguous unlock commands are not automatically replayed |

Cold cloud video can take about half a minute upstream and may exceed Apple Home's waiting time. Preview sessions can expire; reopening starts a new session. Test cold and warm video on your own installation.

One selected entrance is supported per platform. Changing its identity or backend can remove the previous cached accessory; back up your configuration and check Apple Home automations afterward.

For an external, verified FFmpeg source, set `cameraStreamUrl`. DUOX PLUS is not assumed to expose generic RTSP. `cameraForceTranscode` defaults to true; disable it only for an H.264 source that already meets HomeKit's requested video parameters.

## Further reading

- [Home Assistant setup](docs/home-assistant.md)
- [Architecture and security boundaries](docs/architecture.md)
- [Development and hardware acceptance](docs/development.md)
- [Protocol research and upstream credits](docs/research.md)
- [Changes](CHANGELOG.md)

MIT licensed. Based on community research from [cvc90/Fermax-Blue-Intercom](https://github.com/cvc90/Fermax-Blue-Intercom), [AfonsoFGarcia/bluecon](https://github.com/AfonsoFGarcia/bluecon), and [bvis/fermax-blue-hass](https://github.com/bvis/fermax-blue-hass).
