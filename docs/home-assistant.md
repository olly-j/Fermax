# Home Assistant connection

Use this route to let the maintained Fermax integration handle cloud calls and video while Homebridge publishes the accessory to Apple Home.

## Prepare Home Assistant

1. Invite a dedicated user through DuoxMe and finish that user's registration. Using your phone account can replace its push destination.
2. Add [bvis/fermax-blue-hass](https://github.com/bvis/fermax-blue-hass) as a custom **Integration** repository in HACS. Install it and restart HA.
3. Add **Fermax Blue** in **Settings → Devices & services**. Follow its current credential-extraction instructions for the dedicated account and app OAuth/Firebase configuration. The reviewed upstream baseline is `0.20.5`.
4. Verify door release and camera preview in HA before connecting Homebridge.
5. In **Developer Tools → States**, record the real lock, doorbell event, camera and camera-preview button IDs. Current upstream's doorbell entity is `event.*`; its connectivity binary sensor is not a ring source.

## Connect Homebridge

Create a long-lived access token from an HA user profile. In the Homebridge plugin settings select **Home Assistant**, then enter:

| Setting | Example | Purpose |
|---|---|---|
| Server URL | `https://ha.example.com` | HA origin reachable from the Pi |
| Access token | Your HA token | Authenticates API and camera requests |
| Lock entity | `lock.entrance` | Only this lock receives release commands |
| Doorbell event | `event.entrance_doorbell` | Current rings arrive over WebSocket |
| Camera entity | `camera.entrance` | Snapshots and MJPEG video |
| Preview button | `button.entrance_camera_preview` | Wakes the receive-only cloud session |

Replace all example IDs. Leave **Camera Stream URL** blank for automatic HA media. Optional camera/ring fields can be omitted for door-release-only use. The preview button requires a camera entity; an external video URL bypasses the automatic HA stream and preview activation. Save and restart Homebridge.

Tokens grant access beyond the selected entities according to HA permissions. Protect Homebridge configuration, use a dedicated HA user where practical, and prefer HTTPS. HTTP transmits the token in plaintext over the network.

## Video behavior

Homebridge presses the selected preview button, reads HA's authenticated `/api/camera_proxy_stream/<camera entity>` MJPEG endpoint, and transcodes it for HomeKit. It does not require a public RTSP listener or expose HA's debug interface. The upstream `webrtc:` source is not passed to FFmpeg.

MJPEG carries no audio. Cold panel startup can take up to half a minute; Apple Home may stop waiting sooner. Verify cold preview, viewing during a ring, and reopening after the upstream session expires. A local generated-video test validates this adapter, not a physical Fermax installation.

Home Assistant can alternatively publish entities directly using its [HomeKit Bridge](https://www.home-assistant.io/integrations/homekit/). Avoid publishing the same entrance through both publishers. That alternative has its own camera-source requirements.

## Before relying on it

Check a physical ring reaches Apple Home once, door release operates the intended entrance, and video shows a changing live scene. Restart both services and interrupt connectivity to confirm recovery without replaying historical rings. Confirm your original phone still receives calls. The full [acceptance checklist](development.md#hardware-acceptance) covers the remaining checks.
