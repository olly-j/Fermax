#!/usr/bin/env node
/**
 * Postinstall script to ensure config.schema.json is in the correct locations
 * for Homebridge UI to detect it properly.
 * 
 * When installed from GitHub, npm installs the entire repo, so we need to ensure
 * the schema is accessible from the package root where Homebridge UI expects it.
 */

const fs = require('fs');
const path = require('path');

// Determine if we're in the installed package (node_modules) or source repo
const isInstalled = __dirname.includes('node_modules');
const packageJsonPath = path.join(__dirname, 'package.json');

// Find the source schema file
let sourceSchema;
if (isInstalled) {
  // In node_modules, schema should be at package root
  sourceSchema = path.join(__dirname, 'homebridge-fermax-blue', 'config.schema.json');
  // Fallback: check if it's already at root
  if (!fs.existsSync(sourceSchema)) {
    sourceSchema = path.join(__dirname, 'config.schema.json');
  }
} else {
  // In source repo
  sourceSchema = path.join(__dirname, 'homebridge-fermax-blue', 'config.schema.json');
}

const rootSchema = path.join(__dirname, 'config.schema.json');

// Copy schema to package root (where Homebridge UI looks for it)
if (fs.existsSync(sourceSchema)) {
  try {
    // Always ensure schema is at package root
    if (sourceSchema !== rootSchema) {
      fs.copyFileSync(sourceSchema, rootSchema);
    }
    
    // Verify the schema is valid JSON
    const schemaContent = fs.readFileSync(rootSchema, 'utf8');
    JSON.parse(schemaContent); // Will throw if invalid
    
    console.log('✓ config.schema.json is ready at package root for Homebridge UI');
  } catch (error) {
    console.error('✗ Failed to setup config.schema.json:', error.message);
    process.exit(1);
  }
} else {
  console.warn('⚠ Source config.schema.json not found. Expected at:', sourceSchema);
  console.warn('⚠ Homebridge UI configuration may not work properly.');
}

