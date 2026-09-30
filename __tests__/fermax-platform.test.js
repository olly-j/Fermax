const FermaxPlatform = require('../src/FermaxPlatform');
const FermaxClient = require('../src/api/FermaxClient');
const FermaxPushClient = require('../src/push/FermaxPushClient');
const FermaxAccessory = require('../src/FermaxAccessory');
const HomeAssistantClient = require('../src/backend/HomeAssistantClient');

jest.mock('../src/api/FermaxClient');
jest.mock('../src/push/FermaxPushClient');
jest.mock('../src/FermaxAccessory');
jest.mock('../src/backend/HomeAssistantClient');

const mockConfig = {
  username: 'user', password: 'pass', senderId: 'sender',
  firebaseProjectId: 'project', firebaseAppId: 'app', firebaseApiKey: 'key',
  deviceId: 'device-123',
};
const directPairing = {
  deviceId: 'device-123', tag: 'Front Door',
  accessDoorMap: { 'door-1': { accessId: { block: 1, subblock: 0, number: 1 } } },
};
const haConfig = {
  backend: 'homeassistant', homeAssistantUrl: 'http://ha.test:8123',
  homeAssistantToken: 'private-token', homeAssistantCameraEntity: 'camera.front_door',
  homeAssistantLockEntity: 'lock.front_door', homeAssistantRingEntity: 'event.front_door',
  homeAssistantPreviewEntity: 'button.front_door_preview',
};
const haPairing = {
  deviceId: 'camera.front_door', tag: 'Front Door',
  accessDoorMap: { ZERO: { accessId: { entityId: 'lock.front_door' } } },
};

describe('FermaxPlatform', () => {
  let platform;
  let api;
  let log;
  let events;
  let directClient;
  let pushClient;
  let haClient;

  beforeEach(() => {
    jest.resetAllMocks();
    events = {};
    api = {
      on: jest.fn((name, handler) => { events[name] = handler; }),
      hap: { Service: {}, Characteristic: {}, uuid: { generate: jest.fn((id) => `uuid-${id}`) } },
      user: { storagePath: jest.fn().mockReturnValue('/tmp') },
      platformAccessory: jest.fn(function (name, uuid) { this.displayName = name; this.UUID = uuid; }),
      registerPlatformAccessories: jest.fn(), updatePlatformAccessories: jest.fn(), unregisterPlatformAccessories: jest.fn(),
    };
    log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    directClient = {
      getPairings: jest.fn().mockResolvedValue([directPairing]),
      registerAppToken: jest.fn().mockResolvedValue(true), stop: jest.fn().mockResolvedValue(undefined),
      attendedCall: jest.fn(),
    };
    pushClient = { start: jest.fn().mockResolvedValue('token-123'), stop: jest.fn().mockResolvedValue(undefined) };
    haClient = {
      getPairings: jest.fn().mockResolvedValue([haPairing]),
      start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined),
    };
    FermaxClient.mockImplementation(() => directClient);
    FermaxPushClient.mockImplementation(() => pushClient);
    HomeAssistantClient.mockImplementation(() => haClient);
    FermaxAccessory.mockImplementation(() => ({ triggerDoorbell: jest.fn(), dispose: jest.fn() }));
    platform = new FermaxPlatform(log, { ...mockConfig }, api);
  });

  test('initializes direct control with complete Firebase configuration', async () => {
    await platform.initialize();
    expect(FermaxClient).toHaveBeenCalled();
    expect(FermaxPushClient).toHaveBeenCalledWith(expect.objectContaining({
      senderId: 'sender', projectId: 'project', appId: 'app', apiKey: 'key', username: 'user',
    }));
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(directClient.registerAppToken).toHaveBeenCalledWith('token-123', true);
    expect(platform.deviceContext.door).toEqual({ block: 1, subblock: 0, number: 1 });
  });

  test('handles missing configuration credentials', async () => {
    const p = new FermaxPlatform(log, {}, api);
    await p.initialize();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('missing username'));
    expect(FermaxClient).not.toHaveBeenCalled();
  });

  test('partial Firebase configuration leaves control available without push', async () => {
    platform.config = { username: 'user', password: 'pass', senderId: 'sender', deviceId: 'device-123' };
    await platform.initialize();
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(FermaxPushClient).not.toHaveBeenCalled();
    expect(directClient.registerAppToken).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('firebaseApiKey'));
  });

  test('direct push does not require the unused sender ID', async () => {
    delete platform.config.senderId;
    await platform.initialize();
    expect(pushClient.start).toHaveBeenCalledTimes(1);
    expect(directClient.registerAppToken).toHaveBeenCalledWith('token-123', true);
  });

  test.each([
    ['unlockResetSeconds', 0], ['unlockResetSeconds', 61], ['unlockResetSeconds', '8'],
    ['cameraMaxBitrate', 0], ['cameraMaxBitrate', 10001], ['cameraMaxBitrate', 1980.5],
    ['cameraForceTranscode', 'false'], ['cameraDebug', 'true'], ['cameraStreamOptions', {}],
    ['cameraSnapshotUrl', 'file:///private/photo.jpg'], ['cameraSnapshotUrl', 'not a URL'],
  ])('rejects invalid saved %s before connecting', async (field, value) => {
    platform.config[field] = value;
    await expect(platform.initialize()).rejects.toThrow(field);
    expect(FermaxClient).not.toHaveBeenCalled();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  test.each(['clientId', 'clientSecret'])('rejects a partial custom OAuth pair (%s)', async (field) => {
    platform.config[field] = 'custom-value';
    await expect(platform.initialize()).rejects.toThrow('both clientId and clientSecret');
    expect(FermaxClient).not.toHaveBeenCalled();
  });

  test('ignores inactive direct OAuth fields in Home Assistant mode', async () => {
    platform.config = { ...haConfig, clientId: 'saved-inactive-field' };
    await platform.initialize();
    expect(haClient.start).toHaveBeenCalledTimes(1);
  });

  test.each([
    { ...haConfig, homeAssistantCameraEntity: undefined },
    { ...haConfig, cameraStreamUrl: 'rtsp://camera.test/live' },
  ])('does not validate or use an inactive saved HA preview button: %j', async (config) => {
    platform.config = config;
    await platform.initialize();
    expect(HomeAssistantClient).toHaveBeenCalledWith(expect.objectContaining({ previewEntity: undefined }));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('preview button is unused'));
  });

  test('an explicit device mismatch never registers an accessory or push token', async () => {
    platform.config.deviceId = 'other-device';
    await expect(platform.initialize()).rejects.toThrow('does not match exactly one pairing');
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(pushClient.start).not.toHaveBeenCalled();
    expect(directClient.registerAppToken).not.toHaveBeenCalled();
  });

  test('multiple devices require an explicit selector', async () => {
    delete platform.config.deviceId;
    directClient.getPairings.mockResolvedValue([directPairing, { ...directPairing, deviceId: 'device-456' }]);
    await expect(platform.initialize()).rejects.toThrow('Multiple Fermax devices');
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  test.each([
    [{ accessDoorKey: 'unknown' }, 'Configured access door was not found'],
    [{ doorIndex: 3 }, 'Configured access door was not found'],
    [{ doorIndex: -1 }, 'nonnegative integer'],
    [{ doorIndex: 0.5 }, 'nonnegative integer'],
  ])('rejects an invalid door selector %j', async (selector, error) => {
    Object.assign(platform.config, selector);
    await expect(platform.initialize()).rejects.toThrow(error);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  test('multiple doors require an explicit key or index', async () => {
    directClient.getPairings.mockResolvedValue([{
      ...directPairing,
      accessDoorMap: { ...directPairing.accessDoorMap, 'door-2': { accessId: { block: 2, subblock: 0, number: 2 } } },
    }]);
    await expect(platform.initialize()).rejects.toThrow('Multiple access doors');
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    platform.config.accessDoorKey = 'door-2';
    await platform.initialize();
    expect(platform.deviceContext.door).toEqual({ block: 2, subblock: 0, number: 2 });
  });

  test('retains the Home Assistant lock entity and forwards its event connection callback to HomeKit', async () => {
    platform = new FermaxPlatform(log, { ...haConfig }, api);
    await platform.initialize();
    expect(HomeAssistantClient).toHaveBeenCalledWith({
      url: haConfig.homeAssistantUrl, token: haConfig.homeAssistantToken,
      cameraEntity: haConfig.homeAssistantCameraEntity, lockEntity: haConfig.homeAssistantLockEntity,
      ringEntity: haConfig.homeAssistantRingEntity, previewEntity: haConfig.homeAssistantPreviewEntity, logger: log,
    });
    expect(platform.deviceContext.door).toEqual({ entityId: 'lock.front_door' });
    expect(FermaxAccessory).toHaveBeenCalledWith(platform, expect.any(Object), expect.objectContaining({
      deviceId: 'camera.front_door', door: { entityId: 'lock.front_door' },
    }));
    expect(haClient.start).toHaveBeenCalledWith(expect.any(Function));
    await haClient.start.mock.calls[0][0]();
    expect(platform.fermaxAccessory.triggerDoorbell).toHaveBeenCalledTimes(1);
    expect(FermaxClient).not.toHaveBeenCalled();
    expect(FermaxPushClient).not.toHaveBeenCalled();
  });

  test.each(['direct', 'homeassistant'])('shutdown during %s pairing lookup prevents accessory creation and listener startup', async (backend) => {
    let release;
    let entered;
    const lookupStarted = new Promise((resolve) => { entered = resolve; });
    const pairings = new Promise((resolve) => { release = resolve; });
    const client = backend === 'direct' ? directClient : haClient;
    client.getPairings.mockImplementation(() => { entered(); return pairings; });
    platform = new FermaxPlatform(log, backend === 'direct' ? { ...mockConfig } : { ...haConfig }, api);
    const initializing = platform.initialize();
    await lookupStarted;
    await events.shutdown();
    release([backend === 'direct' ? directPairing : haPairing]);
    await initializing;
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(api.platformAccessory).not.toHaveBeenCalled();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(FermaxAccessory).not.toHaveBeenCalled();
    expect(haClient.start).not.toHaveBeenCalled();
    expect(pushClient.start).not.toHaveBeenCalled();
    expect(directClient.registerAppToken).not.toHaveBeenCalled();
  });

  test('modern push envelopes ring once per ID and ignore foreign devices and non-call payloads', async () => {
    await platform.initialize();
    const call = { DeviceId: 'device-123', FermaxNotificationType: 'Call', CallId: 'call-1' };
    const message = { persistentId: 'ring-1', message: { data: JSON.stringify(call) } };
    platform.handleNotification(message);
    platform.handleNotification(message);
    platform.handleNotification({ persistentId: 'foreign', message: { data: { ...call, DeviceId: 'other' } } });
    platform.handleNotification({ persistentId: 'status', message: { data: { ...call, FermaxNotificationType: 'Status' } } });
    platform.handleNotification({ persistentId: 'malformed', message: { data: '{not-json' } });
    expect(platform.fermaxAccessory.triggerDoorbell).toHaveBeenCalledTimes(1);
    expect(platform.fermaxAccessory.triggerDoorbell).toHaveBeenCalledWith(call);
    expect(directClient.attendedCall).not.toHaveBeenCalled();
  });
  test('backend switch ignores stale direct selectors and removes the obsolete cached accessory', async () => {
    platform = new FermaxPlatform(log, { ...haConfig, deviceId: 'old-device', accessDoorKey: 'old-door', doorIndex: 7 }, api);
    const old = { UUID: 'uuid-old-device', displayName: 'Old entrance' };
    const current = { UUID: 'uuid-camera.front_door', displayName: 'Entrance' };
    platform.configureAccessory(old);
    platform.configureAccessory(current);
    await platform.initialize();
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-fermax-blue', 'FermaxBluePlatform', [old]);
    expect(platform.accessories.has(old.UUID)).toBe(false);
    expect(platform.accessories.get(current.UUID)).toBe(current);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.deviceContext.door).toEqual({ entityId: 'lock.front_door' });
  });

});
