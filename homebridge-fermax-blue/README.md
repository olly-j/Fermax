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
2. **Firebase Sender ID** (required) - Extract from the Fermax Blue Android app (see instructions below)
3. Node.js 18+ and Homebridge 1.6+ running on the same host as this plugin.

#### Extracting Firebase Sender ID

The **Sender ID** (also called `project_number`) is required for push notifications. Here's how to extract it:

**Method 1: From Android APK (Recommended)**
1. Download the Fermax Blue APK file to your computer
2. Extract the APK (it's just a ZIP file):
   ```bash
   unzip BlueFermax.apk -d BlueFermax
   ```
3. Find and open `BlueFermax/res/values/google-services.json`
4. Look for the `project_number` field - this is your Sender ID
   ```json
   {
     "project_info": {
       "project_number": "123456789012"  ← This is your Sender ID
     }
   }
   ```

**Method 2: Using apktool (if you have it installed)**
```bash
apktool d BlueFermax.apk
cat BlueFermax/res/values/google-services.json | grep project_number
```

**Note:** You only need the `project_number` (Sender ID) for basic functionality. The other Firebase fields (`projectId`, `apiKey`, etc.) are not required for this plugin.

### Installation
```bash
cd ~/homebridge
npm install homebridge-fermax-blue
```

### Configuration

#### Option 1: Using Homebridge UI (Recommended)

The plugin includes a step-by-step configuration wizard in the Homebridge UI:

1. **Open Homebridge UI** (usually at `http://homebridge-ip:8581`)
2. **Go to Plugins** → Find "homebridge-fermax-blue" → Click **Settings** (gear icon)
3. **Follow the guided steps:**

   **Step 1: Fermax Account Credentials**
   - Enter your Fermax Blue / DuoxMe email and password
   - These are the same credentials you use in the mobile app

   **Step 2: Firebase Sender ID**
   - Extract the `project_number` from the Fermax Blue Android app's `google-services.json`
   - See "Extracting Firebase Credentials" section below for detailed instructions
   - This is typically a 12-digit number

   **Step 3: Device Selection (Optional)**
   - If you have multiple Fermax monitors, specify the device ID or tag
   - Leave blank to use the first available device
   - You can find device IDs in the plugin logs after first run

   **Step 4: Video Streaming (Optional but Recommended)**
   - Enter your camera stream URL (RTSP or HLS)
   - See "Video feed options" section below for details
   - Without this, you'll only get snapshots in notifications

   **Step 5: Advanced Settings (Optional)**
   - Most users can skip these
   - Adjust lock reset timeout, FFmpeg options, etc. as needed

4. **Click Save** and restart Homebridge

#### Option 2: Manual Configuration (CLI)

Run the interactive wizard to produce a valid JSON snippet:
```bash
npx homebridge-fermax-blue setup
```
Paste the generated `fermax-homebridge-config.json` block into Homebridge `config.json`.

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

#### Configuration Issues
- **"Plugin alias could not be determined" or "This plugin must be configured manually"** → This means Homebridge UI can't find the `config.schema.json` file. **Solution:**
  1. Verify the schema file exists:
     ```bash
     ls -la /var/lib/homebridge/node_modules/homebridge-fermax-blue/config.schema.json
     ```
  2. If missing, manually copy it:
     ```bash
     cd /var/lib/homebridge/node_modules/homebridge-fermax-blue
     cp homebridge-fermax-blue/config.schema.json config.schema.json
     ```
  3. Or reinstall to trigger the postinstall script:
     ```bash
     cd /var/lib/homebridge
     npm uninstall homebridge-fermax-blue
     npm install git+https://github.com/olly-j/Fermax.git
     ```
  4. Restart Homebridge and try again.
- **Auth errors** → Re-run the setup wizard and make sure MFA is disabled in the Fermax app. Verify your username/password are correct.
- **Schema still not loading** → Check Homebridge logs for postinstall script errors. The schema must be at `/var/lib/homebridge/node_modules/homebridge-fermax-blue/config.schema.json` (same directory as `package.json`).

#### Functionality Issues
- **No doorbell events** → Double-check that the `senderId` came from the exact Fermax Blue app version installed on your handset. Check Homebridge logs for push notification errors.
- **Snapshot unavailable** → Fermax only stores a photo when "Photocaller" is enabled; turn that option on in the Blue app or provide `cameraSnapshotUrl`.
- **Black video feed** → Confirm `cameraStreamUrl` is reachable via `ffmpeg -i <url> -f null -`. Enable `cameraForceTranscode` for HLS inputs or add RTSP flags via `cameraStreamOptions`.
- **Plugin not appearing** → Check Homebridge logs for errors. Ensure Node.js version is 18+ and all dependencies installed correctly.

### Acknowledgements
- Fermax API insights from [cvc90/Fermax-Blue-Intercom](https://github.com/cvc90/Fermax-Blue-Intercom)
- Push notification and photocall research from [AfonsoFGarcia/bluecon](https://github.com/AfonsoFGarcia/bluecon)

