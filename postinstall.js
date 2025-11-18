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

// Find the source schema file - check multiple possible locations
const possibleSources = [
  path.join(__dirname, 'homebridge-fermax-blue', 'config.schema.json'),
  path.join(__dirname, 'config.schema.json'),
];

let sourceSchema = null;
for (const possiblePath of possibleSources) {
  if (fs.existsSync(possiblePath)) {
    sourceSchema = possiblePath;
    break;
  }
}

if (!sourceSchema) {
  console.error('✗ config.schema.json not found in any expected location');
  console.error('  Checked:', possibleSources.join(', '));
  process.exit(1);
}

const rootSchema = path.join(__dirname, 'config.schema.json');

// Copy schema to package root (where Homebridge UI looks for it)
try {
  // Always copy to ensure it's at the root, even if it already exists
  fs.copyFileSync(sourceSchema, rootSchema);
  
  // Verify the schema is valid JSON and has required fields
  const schemaContent = fs.readFileSync(rootSchema, 'utf8');
  const schema = JSON.parse(schemaContent);
  
  // Validate required fields
  if (!schema.pluginAlias) {
    throw new Error('config.schema.json missing pluginAlias field');
  }
  if (!schema.pluginType) {
    throw new Error('config.schema.json missing pluginType field');
  }
  if (!schema.schema) {
    throw new Error('config.schema.json missing schema field');
  }
  
  // Verify pluginAlias matches platform name
  const packageJsonPath = path.join(__dirname, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (pkg.homebridge && pkg.homebridge.platforms && pkg.homebridge.platforms[0]) {
      const expectedPlatform = pkg.homebridge.platforms[0].platform;
      if (schema.pluginAlias !== expectedPlatform) {
        console.warn(`⚠ Warning: pluginAlias "${schema.pluginAlias}" doesn't match platform "${expectedPlatform}"`);
        console.warn('  This may cause Homebridge UI to not detect the schema correctly.');
      }
    }
  }
  
  console.log(`✓ config.schema.json ready at package root (pluginAlias: ${schema.pluginAlias})`);
} catch (error) {
  console.error('✗ Failed to setup config.schema.json:', error.message);
  if (error instanceof SyntaxError) {
    console.error('  Invalid JSON in schema file');
  }
  process.exit(1);
}

