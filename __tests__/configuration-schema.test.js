const Ajv = require('ajv');
const settings = require('../config.schema.json');
const { validateConfiguration } = require('../src/configuration');

// Homebridge-only annotations (title, placeholder, etc.) are not validator keywords.
const validate = new Ajv({ strict: false, validateFormats: false }).compile(settings.schema);
const direct = { backend: 'direct', username: 'test@example.com', password: 'test-password' };
const ha = {
  backend: 'homeassistant', homeAssistantUrl: 'https://ha.example.com',
  homeAssistantToken: 'test-token', homeAssistantLockEntity: 'lock.entrance',
};

describe('saved settings schema contract', () => {
  test('minimal door-release settings work without optional video or alerts', () => {
    expect(validate({ ...direct })).toBe(true);
    expect(validate({ ...ha })).toBe(true);
    expect(settings.strictValidation).toBe(true);
  });

  test.each(['username', 'password'])('direct setup requires %s', key => {
    const config = { ...direct };
    delete config[key];
    expect(validate(config)).toBe(false);
    expect(validate({ ...direct, [key]: '' })).toBe(false);
  });

  test.each(['homeAssistantUrl', 'homeAssistantToken', 'homeAssistantLockEntity'])('HA setup requires %s', key => {
    const config = { ...ha };
    delete config[key];
    expect(validate(config)).toBe(false);
    expect(validate({ ...ha, [key]: '' })).toBe(false);
  });

  test.each(['clientId', 'clientSecret'])('OAuth pair rejects a lone %s only in direct mode', key => {
    expect(validate({ ...direct, [key]: 'test-app-value' })).toBe(false);
    expect(validate({ ...ha, [key]: 'test-app-value' })).toBe(true);
  });

  test('accepts a complete custom OAuth pair', () => {
    expect(validate({ ...direct, clientId: 'test-client', clientSecret: 'test-secret' })).toBe(true);
  });

  test.each(['firebaseProjectId', 'firebaseAppId', 'firebaseApiKey', 'firebaseVapidKey'])('Firebase %s requires all registration fields in direct mode', key => {
    expect(validate({ ...direct, [key]: 'test-value' })).toBe(false);
    expect(validate({ ...ha, [key]: 'test-value' })).toBe(true);
  });

  test('accepts complete Firebase registration without obsolete sender ID', () => {
    expect(validate({ ...direct, firebaseProjectId: 'test-project', firebaseAppId: 'test-app', firebaseApiKey: 'test-key' })).toBe(true);
  });

  test.each([
    ['homeAssistantUrl', 'https://ha.example.com/path'],
    ['homeAssistantUrl', 'https://user:password@ha.example.com'],
    ['homeAssistantLockEntity', 'switch.entrance'],
    ['homeAssistantRingEntity', 'sensor.entrance'],
    ['homeAssistantCameraEntity', 'event.entrance'],
    ['homeAssistantPreviewEntity', 'lock.entrance'],
    ['cameraSnapshotUrl', 'rtsp://camera.example.com/live'],
  ])('rejects an unsupported %s value', (key, value) => {
    expect(validate({ ...ha, [key]: value })).toBe(false);
  });

  test.each([
    ['unlockResetSeconds', 0], ['unlockResetSeconds', 61], ['unlockResetSeconds', 1.5],
    ['cameraMaxBitrate', 499], ['cameraMaxBitrate', 10001], ['cameraMaxBitrate', 2000.5],
  ])('form and runtime reject invalid %s=%s', (key, value) => {
    expect(validate({ ...direct, [key]: value })).toBe(false);
    expect(() => validateConfiguration({ ...direct, [key]: value })).toThrow();
  });

  test.each([
    ['unlockResetSeconds', 1], ['unlockResetSeconds', 60],
    ['cameraMaxBitrate', 500], ['cameraMaxBitrate', 10000],
  ])('form and runtime accept boundary %s=%s', (key, value) => {
    expect(validate({ ...direct, [key]: value })).toBe(true);
    expect(() => validateConfiguration({ ...direct, [key]: value })).not.toThrow();
  });

  test('manual door index and reviewed endpoint overrides remain accepted', () => {
    expect(validate({ ...direct, doorIndex: 0, fermaxBaseUrl: 'https://pro-duoxme.fermax.io', fermaxAuthUrl: 'https://oauth-pro-duoxme.fermax.io' })).toBe(true);
    const fields = JSON.stringify(settings.layout);
    expect(fields).not.toContain('"key":"doorIndex"');
    expect(fields).not.toContain('"key":"senderId"');
  });
});
