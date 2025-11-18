#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');

async function run() {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });

  stdout.write('\nFermax Blue Homebridge setup wizard\n');
  stdout.write('-----------------------------------\n');
  stdout.write(
    'Gather your Fermax Blue credentials plus Firebase sender ID (project number)\n',
  );
  stdout.write(
    'Sender ID and API keys are stored in the Fermax Blue Android APK under google-services.json.\n\n',
  );

  const username = (await rl.question('Fermax username (email): ')).trim();
  const password = (await rl.question('Fermax password: ')).trim();
  const senderId = (await rl.question('Firebase sender ID (project_number): ')).trim();
  const deviceId = (await rl.question('Preferred Fermax deviceId (optional): ')).trim();
  const accessDoorKey = (
    await rl.question('Door key (ZERO by default, optional): ')
  ).trim();
  const cameraStreamUrl = (
    await rl.question('Camera stream URL (RTSP/HLS, optional): ')
  ).trim();
  const cameraSnapshotUrl = (
    await rl.question('Snapshot URL (optional): ')
  ).trim();
  const forceTranscodeAnswer = (
    await rl.question('Force libx264 transcode? (y/N): ')
  ).trim();

  await rl.close();

  const config = {
    platform: 'FermaxBluePlatform',
    name: 'Fermax Doorbell',
    username,
    password,
    senderId,
    deviceId: deviceId || undefined,
    accessDoorKey: accessDoorKey || undefined,
    cameraStreamUrl: cameraStreamUrl || undefined,
    cameraSnapshotUrl: cameraSnapshotUrl || undefined,
    cameraForceTranscode: /^y(es)?$/i.test(forceTranscodeAnswer),
    unlockResetSeconds: 8,
  };

  const target = path.join(process.cwd(), 'fermax-homebridge-config.json');
  await fs.writeFile(target, JSON.stringify(config, null, 2));

  stdout.write('\nConfiguration written to ');
  stdout.write(target);
  stdout.write('\nPaste this block into Homebridge config.json or use the UI form.\n\n');
}

run().catch((error) => {
  console.error('Setup wizard failed:', error);
  process.exit(1);
});

