## homebridge-fermax-blue

`homebridge-fermax-blue` is a Homebridge platform plugin that exposes Fermax Blue / DuoxMe video doorbells as HomeKit doorbell accessories with lock control and snapshots.

### Features
- Reuses the Fermax OAuth flow and door-control endpoints from [cvc90/Fermax-Blue-Intercom](https://github.com/cvc90/Fermax-Blue-Intercom) to authenticate, discover paired monitors and trigger `directed-opendoor`.
- Implements the Fermax push notification flow documented in [AfonsoFGarcia/bluecon](https://github.com/AfonsoFGarcia/bluecon) so rings are delivered instantly through Firebase Cloud Messaging.
- Publishes a HomeKit `VideoDoorbell` with:
  - Doorbell events mapped to `ProgrammableSwitchEvent.SINGLE_PRESS`
  - `LockMechanism` service to unlock using the Fermax API
  - Snapshot-only camera (HomeKit grabs the last Fermax photocall image on demand)
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
  "unlockResetSeconds": 8
}
```

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
- **Snapshot unavailable** → Fermax only stores a photo when “Photocaller” is enabled; turn that option on in the Blue app.

### Acknowledgements
- Fermax API insights from [cvc90/Fermax-Blue-Intercom](https://github.com/cvc90/Fermax-Blue-Intercom)
- Push notification and photocall research from [AfonsoFGarcia/bluecon](https://github.com/AfonsoFGarcia/bluecon)

