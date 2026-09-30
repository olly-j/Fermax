#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

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
  console.log(`${pkg.name} ${pkg.version}: installation checks passed`);
} catch (error) {
  console.error(`Installation check failed: ${error.message}`);
  console.error('Reinstall in your Homebridge plugin directory and restart Homebridge.');
  process.exitCode = 1;
}
