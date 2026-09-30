#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function probeFfmpeg(executable = require('ffmpeg-for-homebridge') || 'ffmpeg') {
  const result = spawnSync(executable, ['-version'], { timeout: 5000, stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.warn('FFmpeg is unavailable. Door release and alerts can run, but live video needs a working FFmpeg binary. Install FFmpeg or set ffmpegPath in plugin Settings.');
    return false;
  }
  console.log('FFmpeg executable check passed.');
  return true;
}

function verifyInstallation() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.schema.json'), 'utf8'));
    if (schema.pluginAlias !== 'FermaxBluePlatform' || schema.pluginType !== 'platform' || !schema.schema?.properties) {
      throw new Error('Invalid Homebridge configuration schema');
    }
    for (const dependency of Object.keys(pkg.dependencies || {})) {
      require.resolve(dependency, { paths: [__dirname] });
    }
    let registered;
    require('./src/index')({ registerPlatform: (...args) => { registered = args; } });
    if (registered?.[0] !== pkg.name || registered?.[1] !== schema.pluginAlias) {
      throw new Error('Plugin entrypoint and configuration schema disagree');
    }
    probeFfmpeg();
    console.log(`${pkg.name} ${pkg.version}: installation checks passed`);
  } catch (error) {
    console.error(`Installation check failed: ${error.message}`);
    console.error('Reinstall in your Homebridge plugin directory and restart Homebridge.');
    process.exitCode = 1;
  }
}

if (require.main === module) verifyInstallation();
module.exports = { probeFfmpeg, verifyInstallation };
