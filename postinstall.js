#!/usr/bin/env node
/**
 * Postinstall script to fix folder structure when installed from GitHub.
 * 
 * When installed from GitHub, npm installs the entire repo, creating:
 *   node_modules/homebridge-fermax-blue/
 *     - package.json
 *     - homebridge-fermax-blue/  (subdirectory)
 *       - src/
 *       - config.schema.json
 * 
 * This script reorganizes files to the expected structure:
 *   node_modules/homebridge-fermax-blue/
 *     - package.json
 *     - src/
 *     - config.schema.json
 */

const fs = require('fs');
const path = require('path');

const pluginDir = __dirname;
const subDir = path.join(pluginDir, 'homebridge-fermax-blue');

// Check if we're in the nested structure (installed from GitHub)
const isNestedStructure = fs.existsSync(subDir) && fs.existsSync(path.join(subDir, 'src'));

if (isNestedStructure) {
  console.log('📦 Detected nested structure - reorganizing files...');
  
  // Files/directories to copy from subdirectory to root
  const itemsToCopy = [
    { from: 'src', to: 'src', isDir: true },
    { from: 'config.schema.json', to: 'config.schema.json', isDir: false },
    { from: 'README.md', to: 'README.md', isDir: false },
    { from: 'LICENSE', to: 'LICENSE', isDir: false },
    { from: '__tests__', to: '__tests__', isDir: true },
    { from: 'jest.config.js', to: 'jest.config.js', isDir: false },
    { from: 'verify-install.js', to: 'verify-install.js', isDir: false },
  ];
  
  try {
    for (const item of itemsToCopy) {
      const sourcePath = path.join(subDir, item.from);
      const targetPath = path.join(pluginDir, item.to);
      
      if (fs.existsSync(sourcePath)) {
        if (item.isDir) {
          // Copy directory recursively
          copyDirRecursive(sourcePath, targetPath);
        } else {
          // Copy file
          fs.copyFileSync(sourcePath, targetPath);
        }
        console.log(`  ✓ Copied ${item.from}`);
      }
    }
    
    console.log('✅ Files reorganized successfully');
  } catch (error) {
    console.error('✗ Failed to reorganize files:', error.message);
    process.exit(1);
  }
}

// Validate config.schema.json
const schemaPath = path.join(pluginDir, 'config.schema.json');
if (fs.existsSync(schemaPath)) {
  try {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
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
    const packageJsonPath = path.join(pluginDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (pkg.homebridge && pkg.homebridge.platforms && pkg.homebridge.platforms[0]) {
        const expectedPlatform = pkg.homebridge.platforms[0].platform;
        if (schema.pluginAlias !== expectedPlatform) {
          console.warn(`⚠ Warning: pluginAlias "${schema.pluginAlias}" doesn't match platform "${expectedPlatform}"`);
        }
      }
    }
    
    console.log(`✓ config.schema.json validated (pluginAlias: ${schema.pluginAlias})`);
  } catch (error) {
    console.error('✗ Failed to validate config.schema.json:', error.message);
    process.exit(1);
  }
} else {
  console.warn('⚠ config.schema.json not found - Homebridge UI may not work');
}

// Helper function to copy directory recursively
function copyDirRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  
  const entries = fs.readdirSync(source, { withFileTypes: true });
  
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    
    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

