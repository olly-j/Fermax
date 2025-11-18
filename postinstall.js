#!/usr/bin/env node
/**
 * Postinstall script to ensure config.schema.json is in the package root
 * for Homebridge UI to detect it properly.
 */

const fs = require('fs');
const path = require('path');

const sourceSchema = path.join(__dirname, 'homebridge-fermax-blue', 'config.schema.json');
const targetSchema = path.join(__dirname, 'config.schema.json');

// Copy schema to root if it doesn't exist or is older
if (fs.existsSync(sourceSchema)) {
  try {
    fs.copyFileSync(sourceSchema, targetSchema);
    console.log('✓ Copied config.schema.json to package root for Homebridge UI');
  } catch (error) {
    console.warn('⚠ Failed to copy config.schema.json:', error.message);
  }
}

