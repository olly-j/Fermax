#!/usr/bin/env node
const path = require('node:path');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const FileStore = require('../storage/FileStore');
const { validateConfiguration, DEFAULT_UNLOCK_RESET_SECONDS } = require('../configuration');

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
  const config = { platform: 'FermaxBluePlatform', name: 'Fermax Doorbell', unlockResetSeconds: DEFAULT_UNLOCK_RESET_SECONDS };
  try {
    process.stdout.write('\nFermax Homebridge setup — configuration stays on this computer.\n');
    const mode = (await ask('Connection: Home Assistant or direct Fermax? (ha/direct): ')).toLowerCase();
    if (!['ha', 'direct'].includes(mode)) throw new Error('Choose ha or direct');
    config.backend = mode === 'ha' ? 'homeassistant' : 'direct';
    config.name = (await ask('Name in Apple Home (Fermax Doorbell): ')) || 'Fermax Doorbell';
    if (mode === 'ha') {
      config.homeAssistantUrl = await ask('HA server origin: ');
      config.homeAssistantToken = await ask('HA long-lived token (hidden): ', true);
      config.homeAssistantLockEntity = await ask('Exact lock entity: ');
      config.homeAssistantRingEntity = await ask('Doorbell event entity (optional): ');
      config.homeAssistantCameraEntity = await ask('Camera entity (optional): ');
      if (config.homeAssistantCameraEntity) {
        config.homeAssistantPreviewEntity = await ask('Camera preview button entity (optional): ');
      }
    } else {
      config.username = await ask('Dedicated Fermax user email: ');
      config.password = await ask('Fermax password (hidden): ', true);
      if (!config.username || !config.password) throw new Error('Fermax email and password are required.');
      process.stdout.write('Use current OAuth app credentials. Leaving both blank uses an unverified legacy fallback.\n');
      config.clientId = await ask('Current app OAuth client ID (recommended): ');
      if (config.clientId) config.clientSecret = await ask('Current app OAuth client secret (hidden): ', true);
      config.deviceId = await ask('Exact paired device ID (required only for multiple monitors): ');
      config.accessDoorKey = await ask('Exact access door key (required only for multiple doors): ');
      if ((await ask('Configure experimental direct push? (y/N): ')).toLowerCase() === 'y') {
        config.firebaseProjectId = await ask('Firebase project ID: ');
        config.firebaseAppId = await ask('Firebase app ID: ');
        config.firebaseApiKey = await ask('Firebase API key (hidden): ', true);
        config.firebaseVapidKey = await ask('Firebase VAPID key if required (hidden, optional): ', true);
        if (![config.firebaseProjectId, config.firebaseAppId, config.firebaseApiKey].every(Boolean)) {
          throw new Error('Firebase project ID, app ID and API key are required together.');
        }
      }
      config.cameraStreamUrl = await ask('Verified external video URL (optional): ');
    }
    for (const key of Object.keys(config)) if (config[key] === '') delete config[key];
    validateConfiguration(config);
    if (config.backend === 'homeassistant') {
      const HomeAssistantClient = require('../backend/HomeAssistantClient');
      new HomeAssistantClient({ url: config.homeAssistantUrl, token: config.homeAssistantToken,
        lockEntity: config.homeAssistantLockEntity, ringEntity: config.homeAssistantRingEntity,
        cameraEntity: config.homeAssistantCameraEntity, previewEntity: config.homeAssistantPreviewEntity });
    }
    const filename = 'fermax-homebridge-config.json';
    await new FileStore(process.cwd(), filename).write(config);
    process.stdout.write(`\nPrivate configuration written to ${path.join(process.cwd(), filename)}.\nAdd it to Homebridge's platforms list. No connection or door command was made.\n`);
  } finally { rl.close(); }
}
run().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
