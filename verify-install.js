#!/usr/bin/env node
/**
 * Verification script to check if the plugin is correctly installed
 * Run this after installation to verify everything is in place
 */

const fs = require('fs');
const path = require('path');

const pluginRoot = __dirname;
const errors = [];
const warnings = [];

console.log('🔍 Verifying homebridge-fermax-blue installation...\n');

// Check 1: Schema file exists at root
const rootSchema = path.join(pluginRoot, 'config.schema.json');
if (fs.existsSync(rootSchema)) {
  console.log('✓ config.schema.json found at package root');
  
  // Validate schema content
  try {
    const schema = JSON.parse(fs.readFileSync(rootSchema, 'utf8'));
    if (schema.pluginAlias === 'FermaxBluePlatform') {
      console.log('✓ pluginAlias is correct: FermaxBluePlatform');
    } else {
      errors.push(`pluginAlias is "${schema.pluginAlias}" but should be "FermaxBluePlatform"`);
    }
    if (schema.pluginType === 'platform') {
      console.log('✓ pluginType is correct: platform');
    } else {
      errors.push(`pluginType is "${schema.pluginType}" but should be "platform"`);
    }
    if (schema.schema && schema.schema.properties) {
      console.log('✓ Schema structure is valid');
    } else {
      errors.push('Schema structure is invalid');
    }
  } catch (error) {
    errors.push(`Schema JSON is invalid: ${error.message}`);
  }
} else {
  errors.push('config.schema.json NOT found at package root');
  console.log('✗ config.schema.json missing - Homebridge UI will not work');
}

// Check 2: Main entry point exists
const mainEntry = path.join(pluginRoot, 'src', 'index.js');
if (fs.existsSync(mainEntry)) {
  console.log('✓ Main entry point (src/index.js) exists');
} else {
  errors.push('Main entry point (src/index.js) missing');
}

// Check 3: Core files exist
const coreFiles = [
  'src/FermaxPlatform.js',
  'src/FermaxAccessory.js',
  'src/FermaxCamera.js',
  'src/api/FermaxClient.js',
  'src/push/FermaxPushClient.js',
];
coreFiles.forEach((file) => {
  const filePath = path.join(pluginRoot, file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file} exists`);
  } else {
    errors.push(`${file} is missing`);
  }
});

// Check 4: Package.json has correct structure
const packageJson = path.join(pluginRoot, 'package.json');
if (fs.existsSync(packageJson)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    if (pkg.homebridge && pkg.homebridge.platforms) {
      const platform = pkg.homebridge.platforms[0];
      if (platform && platform.platform === 'FermaxBluePlatform') {
        console.log('✓ package.json has correct platform configuration');
      } else {
        errors.push('package.json platform configuration is incorrect');
      }
    } else {
      errors.push('package.json missing homebridge.platforms configuration');
    }
  } catch (error) {
    errors.push(`package.json is invalid: ${error.message}`);
  }
}

// Check 5: Dependencies
console.log('\n📦 Checking dependencies...');
const nodeModules = path.join(pluginRoot, '..', 'node_modules');
const requiredDeps = ['hap-nodejs', 'homebridge', 'push-receiver', '@homebridge/camera-utils'];
requiredDeps.forEach((dep) => {
  const depPath = path.join(nodeModules, dep);
  if (fs.existsSync(depPath)) {
    console.log(`✓ ${dep} is installed`);
  } else {
    warnings.push(`${dep} may not be installed (check parent node_modules)`);
  }
});

// Summary
console.log('\n' + '='.repeat(50));
if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ All checks passed! Plugin is correctly installed.');
  console.log('\nIf Homebridge UI still shows "Plugin alias could not be determined":');
  console.log('1. Restart Homebridge completely');
  console.log('2. Clear browser cache and reload Homebridge UI');
  console.log('3. Check Homebridge logs for any errors');
  process.exit(0);
} else {
  if (errors.length > 0) {
    console.log('❌ ERRORS FOUND:');
    errors.forEach((error) => console.log(`  - ${error}`));
  }
  if (warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:');
    warnings.forEach((warning) => console.log(`  - ${warning}`));
  }
  console.log('\n💡 To fix:');
  console.log('  1. Reinstall: npm uninstall homebridge-fermax-blue && npm install git+https://github.com/olly-j/Fermax.git');
  console.log('  2. Manually copy schema: cp homebridge-fermax-blue/config.schema.json config.schema.json');
  console.log('  3. Restart Homebridge');
  process.exit(1);
}

