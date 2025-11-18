## homebridge-fermax-blue

`homebridge-fermax-blue` is a Homebridge platform plugin that exposes Fermax Blue / DuoxMe video doorbells as HomeKit doorbell accessories with lock control, doorbell pushes, and live video.

### Features
- Reuses the Fermax OAuth flow and door-control endpoints from [cvc90/Fermax-Blue-Intercom](https://github.com/cvc90/Fermax-Blue-Intercom) to authenticate, discover paired monitors and trigger `directed-opendoor`.
- Implements the Fermax push notification flow documented in [AfonsoFGarcia/bluecon](https://github.com/AfonsoFGarcia/bluecon) so rings are delivered instantly through Firebase Cloud Messaging.
- Publishes a HomeKit `VideoDoorbell` with:
  - Doorbell events mapped to `ProgrammableSwitchEvent.SINGLE_PRESS`
  - `LockMechanism` service to unlock using the Fermax API
  - Real video feed (FFmpeg restreams whatever `cameraStreamUrl` you provide; falls back to Fermax photocaller snapshots if no stream is configured)
- CLI setup wizard plus Homebridge UI schema help you capture every secret that Fermax requires.

### Requirements
1. Fermax Blue credentials (username + password) that already control your VEO-XS WiFi (DUOX Plus) monitor.
2. Firebase Cloud Messaging project parameters from the Fermax Blue Android app:
   - `senderId` (a.k.a `project_number`)
   - `projectId`
   - `mobilesdk_app_id`
   - `current_key`
   - Android package name (`com.fermax.bluefermax`)

   Extract these from the `google-services.json` file inside the Fermax Blue APK:
   ```bash
   apktool d BlueFermax.apk
   cat BlueFermax/res/values/google-services.json
   ```
3. Node.js 18+ and Homebridge 1.6+ running on the same host as this plugin.

### Installation
```bash
cd ~/homebridge
npm install homebridge-fermax-blue
```

### Guided configuration
Run the interactive wizard to produce a valid JSON snippet:
```bash
npx homebridge-fermax-blue setup
```
Paste the generated `fermax-homebridge-config.json` block into Homebridge `config.json`, or use the Homebridge UI (Config UI X) which surfaces the same schema.

Example config:
```json
{
  "platform": "FermaxBluePlatform",
  "name": "Fermax Doorbell",
  "username": "user@example.com",
  "password": "superSecret",
  "senderId": "123456789012",
  "deviceId": "e6e9df9010ab",
  "accessDoorKey": "ZERO",
  "cameraStreamUrl": "rtsp://veo-xs.local:554/live/ch00_0",
  "cameraSnapshotUrl": "https://blue.fermax.io/callmanager/api/v1/photocall/last.jpg",
  "cameraForceTranscode": true,
  "unlockResetSeconds": 8
}
```

### Video feed options
Set `cameraStreamUrl` to any FFmpeg-compatible source:

1. **Fermax Blue cloud feed** – When a push notification arrives, Fermax includes `SocketUrl`, `RoomId`, and `FermaxToken`. Converting the socket URL to HTTPS and appending `/playlist.m3u8?fermaxToken=<token>` yields a short-lived HLS feed that you can plug straight into `cameraStreamUrl`. Use tools such as mitmproxy or Wireshark on the phone that runs Blue to capture those values once, then automate refreshing them via a small script if needed.
2. **Local RTSP** – If your monitor exposes a LAN RTSP feed (common when “BlueStream” is enabled), point `cameraStreamUrl` at the RTSP endpoint and add `"-rtsp_transport tcp"` to `cameraStreamOptions` for stability.
3. **Custom proxy** – You can host your own ffmpeg/http proxy that speaks Fermax’s `SocketUrl` and serves an HLS playlist; supply that URL here.

Optional fields:
- `cameraSnapshotUrl`: HTTP JPEG to use for HomeKit snapshots (falls back to Fermax photocaller via the cloud API).
- `cameraForceTranscode`: Force libx264 for protocols such as HLS; leave `false` to let FFmpeg copy H.264 bitstreams directly.
- `cameraStreamOptions`: Extra FFmpeg input flags (`"-rtsp_transport tcp"` etc.).
- `cameraMaxBitrate`, `ffmpegPath`, `cameraDebug`: advanced tuning knobs for bandwidth, binary path, and verbose logging.

### Testing
The project ships with Jest tests that stub the Fermax HTTP layer. Run them before publishing:
```bash
npm test
```

For end-to-end validation:
1. Install the plugin with your credentials.
2. Watch the Homebridge logs for `Fermax Blue notifications ready`.
3. Press the physical Fermax button → HomeKit should raise a doorbell alert with the latest snapshot.
4. Tap “Unlock” in Apple Home → door strike should activate and state resets after the configured timeout.

### Troubleshooting
- **Auth errors** → re-run the setup wizard and make sure MFA is disabled in the Fermax app.
- **No doorbell events** → double-check that the `senderId` and `projectId` came from the exact Fermax Blue app version installed on your handset.
- **Snapshot unavailable** → Fermax only stores a photo when “Photocaller” is enabled; turn that option on in the Blue app or provide `cameraSnapshotUrl`.
- **Black video feed** → confirm `cameraStreamUrl` is reachable via `ffmpeg -i <url> -f null -`. Enable `cameraForceTranscode` for HLS inputs or add RTSP flags via `cameraStreamOptions`.

### Acknowledgements
- Fermax API insights from [cvc90/Fermax-Blue-Intercom](https://github.com/cvc90/Fermax-Blue-Intercom)
- Push notification and photocall research from [AfonsoFGarcia/bluecon](https://github.com/AfonsoFGarcia/bluecon)

