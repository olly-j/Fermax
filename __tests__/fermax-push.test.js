const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PushReceiver } = require('@eneris/push-receiver');
const FermaxPushClient = require('../src/push/FermaxPushClient');

jest.mock('@eneris/push-receiver', () => ({ PushReceiver: jest.fn() }));

describe('FermaxPushClient', () => {
  let dataDir;
  let receivers;
  let clients;
  let logger;
  const configuration = {
    senderId: 'sender', projectId: 'project', appId: 'app', apiKey: 'key',
    vapidKey: 'vapid', username: 'first@example.test',
  };

  function makeClient(overrides = {}) {
    const client = new FermaxPushClient({ ...configuration, dataDir, logger, ...overrides });
    clients.push(client);
    return client;
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fermax-push-test-'));
    receivers = [];
    clients = [];
    logger = { warn: jest.fn(), info: jest.fn() };
    PushReceiver.mockReset();
    PushReceiver.mockImplementation((options) => {
      const receiver = {
        options,
        fcmToken: 'initial-token',
        connect: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn(),
        onCredentialsChanged: jest.fn((handler) => { receiver.credentialsChanged = handler; }),
        onNotification: jest.fn((handler) => { receiver.notification = handler; }),
      };
      receivers.push(receiver);
      return receiver;
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await Promise.all(clients.map((client) => client.stop()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  test.each(['projectId', 'appId', 'apiKey'])('requires Firebase %s', (field) => {
    for (const value of [undefined, '', 123]) {
      expect(() => makeClient({ [field]: value })).toThrow('Firebase project ID');
    }
    expect(PushReceiver).not.toHaveBeenCalled();
  });

  test('passes the complete Firebase configuration and returns the receiver token', async () => {
    const client = makeClient();
    await expect(client.start(jest.fn())).resolves.toBe('initial-token');
    expect(PushReceiver).toHaveBeenCalledWith({
      firebase: { projectId: 'project', appId: 'app', apiKey: 'key' },
      vapidKey: 'vapid', credentials: undefined, persistentIds: [], debug: false,
    });
    expect(receivers[0].connect).toHaveBeenCalledTimes(1);
  });

  test('connects without the unused sender ID and preserves old configuration compatibility', async () => {
    const client = makeClient({ senderId: undefined });
    await expect(client.start(jest.fn())).resolves.toBe('initial-token');
    expect(receivers[0].options.firebase).toEqual({ projectId: 'project', appId: 'app', apiKey: 'key' });
  });

  test('isolates persisted credentials and delivery IDs by account and Firebase configuration', async () => {
    const first = makeClient();
    const same = makeClient();
    const otherAccount = makeClient({ username: 'second@example.test' });
    const otherProject = makeClient({ projectId: 'other-project' });
    const otherVapid = makeClient({ vapidKey: 'other-vapid' });
    expect(first.credentialsStore.filePath).toBe(same.credentialsStore.filePath);
    for (const other of [otherAccount, otherProject, otherVapid]) {
      expect(other.credentialsStore.filePath).not.toBe(first.credentialsStore.filePath);
      expect(other.persistentStore.filePath).not.toBe(first.persistentStore.filePath);
    }
    await first.credentialsStore.write({ fcm: { token: 'cached-first-token' } });
    await first.persistentStore.write(['first-id']);
    await otherAccount.start(jest.fn());
    expect(receivers[0].options.credentials).toBeUndefined();
    expect(receivers[0].options.persistentIds).toEqual([]);
    expect(path.basename(first.credentialsStore.filePath)).not.toContain(configuration.username);
  });

  test('loads cached credentials and the last 100 persisted delivery IDs on restart', async () => {
    const client = makeClient();
    const credentials = { fcm: { token: 'cached-token' }, gcm: { androidId: 'cached-android' } };
    const ids = Array.from({ length: 105 }, (_, i) => `id-${i}`);
    await client.credentialsStore.write(credentials);
    await client.persistentStore.write(ids);
    await client.start(jest.fn());
    expect(receivers[0].options.credentials).toEqual(credentials);
    expect(receivers[0].options.persistentIds).toEqual(ids.slice(-100));
  });

  test('persists credentials before registering a rotated token', async () => {
    const client = makeClient();
    const registered = [];
    client.tokenChanged = jest.fn(async (token) => {
      registered.push({ token, stored: await client.credentialsStore.read() });
    });
    await client.start(jest.fn());
    const first = { fcm: { token: 'rotated-token-1' } };
    const second = { fcm: { token: 'rotated-token-2' } };
    receivers[0].credentialsChanged({ newCredentials: first });
    receivers[0].credentialsChanged({ newCredentials: second });
    await client.queue;
    expect(registered).toEqual([
      { token: 'rotated-token-1', stored: first },
      { token: 'rotated-token-2', stored: second },
    ]);
    expect(await client.credentialsStore.read()).toEqual(second);
    expect((await fs.stat(client.credentialsStore.filePath)).mode & 0o777).toBe(0o600);
  });

  test('deduplicates delivery IDs and persists them for the next session', async () => {
    const callback = jest.fn();
    const client = makeClient();
    await client.start(callback);
    receivers[0].notification({ persistentId: 'id-one', message: { data: 'first' } });
    receivers[0].notification({ persistentId: 'id-one', message: { data: 'duplicate' } });
    receivers[0].notification({ persistentId: 'id-two', message: { data: 'second' } });
    await client.queue;
    expect(callback).toHaveBeenCalledTimes(2);
    expect(await client.persistentStore.read()).toEqual(['id-one', 'id-two']);
    await client.stop();
    const restarted = makeClient();
    const onRestart = jest.fn();
    await restarted.start(onRestart);
    receivers[1].notification({ persistentId: 'id-one' });
    receivers[1].notification({ persistentId: 'id-three' });
    await restarted.queue;
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith({ persistentId: 'id-three' });
    expect(await restarted.persistentStore.read()).toEqual(['id-one', 'id-two', 'id-three']);
  });

  test('serializes notification delivery and persistence before processing the next notification', async () => {
    const client = makeClient();
    let release;
    let entered;
    const firstEntered = new Promise((resolve) => { entered = resolve; });
    const blocked = new Promise((resolve) => { release = resolve; });
    const callback = jest.fn(async (message) => {
      if (message.persistentId === 'first') { entered(); await blocked; }
    });
    await client.start(callback);
    const write = jest.spyOn(client.persistentStore, 'write');
    receivers[0].notification({ persistentId: 'first' });
    receivers[0].notification({ persistentId: 'second' });
    await firstEntered;
    expect(callback).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    release();
    await client.queue;
    expect(callback).toHaveBeenCalledTimes(2);
    expect(write.mock.calls).toEqual([[['first']], [['first', 'second']]]);
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[1]);
  });

  test('bounds delivery history to 100 IDs while messages without IDs remain deliverable', async () => {
    const client = makeClient();
    const ids = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    await client.persistentStore.write(ids);
    const callback = jest.fn();
    await client.start(callback);
    receivers[0].notification({ persistentId: 'new' });
    receivers[0].notification({ message: 'unidentified' });
    receivers[0].notification({ message: 'unidentified' });
    await client.queue;
    expect(await client.persistentStore.read()).toEqual([...ids.slice(1), 'new']);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  test('stop destroys the connection and suppresses late notifications and token registration', async () => {
    const client = makeClient();
    const callback = jest.fn();
    client.tokenChanged = jest.fn();
    await client.start(callback);
    const receiver = receivers[0];
    await client.stop();
    receiver.notification({ persistentId: 'late' });
    receiver.credentialsChanged({ newCredentials: { fcm: { token: 'late-token' } } });
    await client.queue;
    expect(receiver.destroy).toHaveBeenCalledTimes(1);
    expect(client.client).toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(client.tokenChanged).not.toHaveBeenCalled();
    await client.stop();
    expect(receiver.destroy).toHaveBeenCalledTimes(1);
  });

  test('a previous receiver cannot overwrite credentials from the new session', async () => {
    const client = makeClient();
    client.tokenChanged = jest.fn();
    await client.start(jest.fn());
    const previous = receivers[0];
    await client.start(jest.fn());
    const current = receivers[1];
    const credentials = { fcm: { token: 'current-token' } };
    current.credentialsChanged({ newCredentials: credentials });
    await client.queue;
    const write = jest.spyOn(client.credentialsStore, 'write');
    previous.credentialsChanged({ newCredentials: { fcm: { token: 'stale-token' } } });
    await client.queue;
    expect(write).not.toHaveBeenCalled();
    expect(await client.credentialsStore.read()).toEqual(credentials);
    expect(client.tokenChanged).toHaveBeenCalledTimes(1);
    expect(client.tokenChanged).toHaveBeenCalledWith('current-token');
  });

  test('a failed notification callback permits redelivery of its ID', async () => {
    const client = makeClient();
    const callback = jest.fn()
      .mockRejectedValueOnce(new Error('temporary delivery failure'))
      .mockResolvedValue(undefined);
    await client.start(callback);
    const message = { persistentId: 'retry-id' };
    receivers[0].notification(message);
    await client.queue;
    expect(await client.persistentStore.read([])).toEqual([]);
    receivers[0].notification(message);
    await client.queue;
    expect(callback).toHaveBeenCalledTimes(2);
    expect(await client.persistentStore.read()).toEqual(['retry-id']);
    receivers[0].notification(message);
    await client.queue;
    expect(callback).toHaveBeenCalledTimes(2);
  });

  test('a persistence failure does not redeliver an already emitted notification in the session', async () => {
    const client = makeClient();
    const callback = jest.fn();
    await client.start(callback);
    jest.spyOn(client.persistentStore, 'write').mockRejectedValueOnce(new Error('disk unavailable'));
    const message = { persistentId: 'emitted-id' };
    receivers[0].notification(message);
    await client.queue;
    receivers[0].notification(message);
    await client.queue;
    expect(callback).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Fermax push delivery or persistence failed');
  });

  test('cleans up a rejected connection', async () => {
    PushReceiver.mockImplementationOnce(() => {
      const receiver = {
        onCredentialsChanged: jest.fn(), onNotification: jest.fn(),
        connect: jest.fn().mockRejectedValue(new Error('connection failed')), destroy: jest.fn(),
      };
      receivers.push(receiver);
      return receiver;
    });
    const client = makeClient();
    await expect(client.start(jest.fn())).rejects.toThrow('connection failed');
    expect(receivers[0].destroy).toHaveBeenCalledTimes(1);
    expect(client.client).toBeNull();
    expect(client.stopped).toBe(true);
  });

  test('cleans up when registration supplies no token', async () => {
    const original = PushReceiver.getMockImplementation();
    PushReceiver.mockImplementationOnce((options) => ({ ...original(options), fcmToken: '' }));
    const client = makeClient();
    await expect(client.start(jest.fn())).rejects.toThrow('no token');
    expect(receivers[0].destroy).toHaveBeenCalledTimes(1);
    expect(client.client).toBeNull();
  });

  test('times out a stalled startup and destroys its receiver', async () => {
    jest.useFakeTimers();
    const original = PushReceiver.getMockImplementation();
    PushReceiver.mockImplementationOnce((options) => {
      const receiver = original(options);
      receiver.connect.mockImplementation(() => new Promise(() => {}));
      return receiver;
    });
    const client = makeClient();
    jest.spyOn(client.credentialsStore, 'read').mockResolvedValue(null);
    jest.spyOn(client.persistentStore, 'read').mockResolvedValue([]);
    const starting = client.start(jest.fn());
    const result = expect(starting).rejects.toThrow('Push connection timed out');
    await jest.advanceTimersByTimeAsync(30000);
    await result;
    expect(receivers[0].destroy).toHaveBeenCalledTimes(1);
    expect(client.client).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('stop immediately cancels a stalled connection and clears its startup timer', async () => {
    jest.useFakeTimers();
    const original = PushReceiver.getMockImplementation();
    PushReceiver.mockImplementationOnce((options) => {
      const receiver = original(options);
      receiver.connect.mockImplementation(() => new Promise(() => {}));
      return receiver;
    });
    const client = makeClient();
    jest.spyOn(client.credentialsStore, 'read').mockResolvedValue(null);
    jest.spyOn(client.persistentStore, 'read').mockResolvedValue([]);
    const starting = client.start(jest.fn());
    const result = expect(starting).rejects.toThrow('Push startup stopped');
    await jest.advanceTimersByTimeAsync(0);
    expect(receivers[0].connect).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    await client.stop();
    await result;
    expect(receivers[0].destroy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(client.client).toBeNull();
  });

  test('late completion of a cancelled connection is destroyed without stopping the new session', async () => {
    jest.useFakeTimers();
    let complete;
    const pending = new Promise((resolve) => { complete = resolve; });
    const original = PushReceiver.getMockImplementation();
    PushReceiver.mockImplementationOnce((options) => {
      const receiver = original(options);
      receiver.connect.mockReturnValue(pending);
      return receiver;
    });
    const client = makeClient();
    jest.spyOn(client.credentialsStore, 'read').mockResolvedValue(null);
    jest.spyOn(client.persistentStore, 'read').mockResolvedValue([]);
    const starting = client.start(jest.fn());
    const result = expect(starting).rejects.toThrow('Push startup stopped');
    await jest.advanceTimersByTimeAsync(0);
    const stale = receivers[0];
    const restarting = client.start(jest.fn());
    await result;
    await expect(restarting).resolves.toBe('initial-token');
    const current = receivers[1];
    complete();
    await jest.advanceTimersByTimeAsync(0);
    expect(stale.destroy).toHaveBeenCalledTimes(2);
    expect(current.destroy).not.toHaveBeenCalled();
    expect(client.client).toBe(current);
    expect(client.stopped).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
