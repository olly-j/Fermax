#!/usr/bin/env node
const path = require('node:path');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const FileStore = require('../storage/FileStore');

async function run() {
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  } });
  output.isTTY = process.stdout.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  const ask = async (label, secret = false) => {
    if (!secret) return (await rl.question(label)).trim();
    process.stdout.write(label);
    muted = true;
    try { return await rl.question(''); }
    finally { muted = false; process.stdout.write('\n'); }
  };
  const config = { platform: 'FermaxBluePlatform', name: 'Fermax Doorbell', unlockResetSeconds: 8 };
  try {
    process.stdout.write('\nFermax Homebridge setup — configuration stays on this computer.\n');
    const mode = await ask('Connection: Home Assistant or direct Fermax? (ha/direct): ');
    if (!['ha', 'direct'].includes(mode)) throw new Error('Choose ha or direct');
    config.backend = mode === 'ha' ? 'homeassistant' : 'direct';
    if (mode === 'ha') {
      config.homeAssistantUrl = await ask('HA server origin: ');
      config.homeAssistantToken = await ask('HA long-lived token (hidden): ', true);
      config.homeAssistantLockEntity = await ask('Exact lock entity: ');
      config.homeAssistantRingEntity = await ask('Doorbell event entity (optional): ');
      config.homeAssistantCameraEntity = await ask('Camera entity (optional): ');
      config.homeAssistantPreviewEntity = await ask('Camera preview button entity (optional): ');
      const HomeAssistantClient = require('../backend/HomeAssistantClient');
      new HomeAssistantClient({ url: config.homeAssistantUrl, token: config.homeAssistantToken,
        lockEntity: config.homeAssistantLockEntity, ringEntity: config.homeAssistantRingEntity,
        cameraEntity: config.homeAssistantCameraEntity, previewEntity: config.homeAssistantPreviewEntity });
    } else {
      config.username = await ask('Dedicated Fermax user email: ');
      config.password = await ask('Fermax password (hidden): ', true);
      config.clientId = await ask('Current app OAuth client ID: ');
      config.clientSecret = await ask('Current app OAuth client secret (hidden): ', true);
      config.deviceId = await ask('Exact paired device ID: ');
      config.accessDoorKey = await ask('Exact access door key: ');
      if (![config.username, config.password, config.clientId, config.clientSecret, config.deviceId, config.accessDoorKey].every(Boolean)) {
        throw new Error('Direct setup requires account, app OAuth credentials and exact device/door');
      }
      if ((await ask('Configure experimental direct push? (y/N): ')).toLowerCase() === 'y') {
        config.senderId = await ask('Firebase messaging sender ID: ');
        config.firebaseProjectId = await ask('Firebase project ID: ');
        config.firebaseAppId = await ask('Firebase app ID: ');
        config.firebaseApiKey = await ask('Firebase API key (hidden): ', true);
        config.firebaseVapidKey = await ask('Firebase VAPID key if required (hidden, optional): ', true);
        if (![config.senderId, config.firebaseProjectId, config.firebaseAppId, config.firebaseApiKey].every(Boolean)) {
          throw new Error('All four Firebase fields are required');
        }
      }
      config.cameraStreamUrl = await ask('Verified external video URL (optional): ');
    }
    for (const key of Object.keys(config)) if (config[key] === '') delete config[key];
    const filename = 'fermax-homebridge-config.json';
    await new FileStore(process.cwd(), filename).write(config);
    process.stdout.write(`\nPrivate configuration written to ${path.join(process.cwd(), filename)}.\nAdd it to Homebridge's platforms list. No connection or door command was made.\n`);
  } finally { rl.close(); }
}
run().catch(() => {
  console.error('Setup failed. Check the entered values and write permissions.');
  process.exitCode = 1;
});
