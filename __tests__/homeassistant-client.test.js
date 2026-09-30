const http = require('node:http');
const HomeAssistantClient = require('../src/backend/HomeAssistantClient');

class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.handlers = {}; this.sent = []; FakeSocket.instances.push(this); }
  addEventListener(type, callback) { (this.handlers[type] ||= []).push(callback); }
  send(data) { this.sent.push(JSON.parse(data)); }
  emit(type, data) { for (const callback of this.handlers[type] || []) callback(data); }
  message(data) { this.emit('message', { data: JSON.stringify(data) }); }
  close() { this.closed = true; this.emit('close'); }
}

const stateResponse = (entity_id, state = 'off') => ({ ok: true,
  json: async () => ({ entity_id, state, attributes: { friendly_name: 'Front Door' } }) });
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
function create(fetchImpl = jest.fn()) {
  return new HomeAssistantClient({ url: 'https://ha.example', token: 'private-token',
    cameraEntity: 'camera.front_door', lockEntity: 'lock.front_door',
    ringEntity: 'binary_sensor.front_door_ring', fetchImpl, WebSocketImpl: FakeSocket,
    logger: { warn: jest.fn(), info: jest.fn() } });
}
function authenticate(socket) {
  socket.message({ type: 'auth_required' });
  socket.message({ type: 'auth_ok' });
  socket.message({ type: 'result', id: 1, success: true });
}
function edge(socket, oldState, newState, entity = 'binary_sensor.front_door_ring') {
  socket.message({ type: 'event', id: 1, event: { data: { entity_id: entity,
    old_state: { state: oldState }, new_state: { state: newState } } } });
}

describe('Home Assistant backend', () => {
  beforeEach(() => { FakeSocket.instances = []; });
  afterEach(() => { jest.useRealTimers(); });

  test('validates entity domains and server URL before any request', () => {
    expect(() => new HomeAssistantClient({ url: 'https://ha.example', token: 'token', lockEntity: 'switch.door' })).toThrow('lock entity');
    expect(() => new HomeAssistantClient({ url: 'https://user:pass@ha.example', token: 'token', lockEntity: 'lock.door' })).toThrow('origin');
    expect(() => new HomeAssistantClient({ url: 'https://ha.example', token: 'token', lockEntity: 'lock.door', cameraEntity: '../secret' })).toThrow('camera entity');
  });

  test('discovers only selected entities and scopes bearer token to API origin', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(stateResponse('lock.front_door'))
      .mockResolvedValueOnce(stateResponse('camera.front_door'));
    const client = create(fetch);
    expect(await client.getPairings()).toEqual([{ deviceId: 'camera.front_door', tag: 'Front Door',
      accessDoorMap: { ZERO: { accessId: { entityId: 'lock.front_door' } } } }]);
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://ha.example/api/states/lock.front_door',
      expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer private-token' }) }));
    await expect(client.request('https://evil.example/api/states')).rejects.toThrow('origin');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('rejects returned entity mismatch', async () => {
    const client = create(jest.fn().mockResolvedValue(stateResponse('lock.other')));
    await expect(client.getPairings()).rejects.toThrow('unexpected lock');
  });

  test('unlocks only mapped lock and does not retry an uncertain failure', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('secret URL private-token'));
    const client = create(fetch);
    await expect(client.openDoor('camera.other', { entityId: 'lock.front_door' })).rejects.toThrow('target');
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.openDoor('camera.front_door', { entityId: 'lock.front_door' })).rejects.toThrow('request failed');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST',
      body: JSON.stringify({ entity_id: 'lock.front_door' }) }));
  });

  test('bounds stalled requests and aborts active work on shutdown', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('private-token')));
    }));
    const client = create(fetch);
    const timeout = expect(client.request('/api/states/lock.front_door')).rejects.toThrow('request failed or timed out');
    await jest.advanceTimersByTimeAsync(10000);
    await timeout;
    const shutdown = expect(client.request('/api/states/lock.front_door')).rejects.toThrow('request failed or timed out');
    await client.stop();
    await shutdown;
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each(['json', 'buffer', 'none'])('real HTTP %s body reads remain bounded after headers', async (responseType) => {
    const sockets = new Set();
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{'); // Send headers and partial body, then deliberately stall.
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const client = new HomeAssistantClient({ url: `http://127.0.0.1:${server.address().port}`,
      token: 'private-token', lockEntity: 'lock.front_door', requestTimeoutMs: 100 });
    try {
      await expect(client.request('/api/states/lock.front_door', { responseType }))
        .rejects.toThrow('request failed or timed out');
      expect(client.controllers.size).toBe(0);
    } finally {
      await client.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('shutdown aborts a real HTTP body that has already sent headers', async () => {
    const sockets = new Set();
    let headersSent;
    const ready = new Promise((resolve) => { headersSent = resolve; });
    const server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.write('{');
      headersSent();
    });
    server.on('connection', (socket) => sockets.add(socket));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const client = new HomeAssistantClient({ url: `http://127.0.0.1:${server.address().port}`,
      token: 'private-token', lockEntity: 'lock.front_door' });
    try {
      const pending = expect(client.request('/api/states/lock.front_door', { responseType: 'json' }))
        .rejects.toThrow('request failed or timed out');
      await ready;
      await client.stop();
      await pending;
      expect(client.controllers.size).toBe(0);
    } finally {
      await client.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('returns selected camera snapshot bytes', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer });
    const client = create(fetch);
    expect(await client.getLastPicture('camera.front_door')).toEqual(Buffer.from([1, 2, 3]));
    expect(fetch.mock.calls[0][0]).toBe('https://ha.example/api/camera_proxy/camera.front_door');
  });

  test('uses authenticated same-origin video and only selected preview command', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true });
    const client = new HomeAssistantClient({ url: 'https://ha.example', token: 'private-token',
      lockEntity: 'lock.front_door', cameraEntity: 'camera.front_door',
      previewEntity: 'button.front_door_camera_preview', fetchImpl: fetch });
    expect(await client.getVideoSource()).toEqual({
      url: 'https://ha.example/api/camera_proxy_stream/camera.front_door',
      inputArgs: ['-headers', 'Authorization: Bearer private-token\r\n'], forceTranscode: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ha.example/api/services/button/press');
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ entity_id: 'button.front_door_camera_preview' }));
  });

  test('event entities emit fresh ring timestamps and suppress initial, duplicate, unavailable and replay', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T12:00:30Z'));
    const entity = 'event.front_door_doorbell';
    const t0 = '2026-09-30T12:00:00.000+00:00';
    const t1 = '2026-09-30T12:01:00.000+00:00';
    const t2 = '2026-09-30T12:02:00.000+00:00';
    const fetch = jest.fn().mockResolvedValue(stateResponse(entity, t0));
    const client = new HomeAssistantClient({ url: 'https://ha.example', token: 'private-token',
      lockEntity: 'lock.front_door', ringEntity: entity, fetchImpl: fetch, WebSocketImpl: FakeSocket });
    const ring = jest.fn();
    const starting = client.start(ring);
    await flush();
    const socket = FakeSocket.instances[0];
    authenticate(socket);
    await starting;
    const event = (oldState, newState, eventType = 'ring') => socket.message({ type: 'event', id: 1,
      event: { data: { entity_id: entity, old_state: { state: oldState },
        new_state: { state: newState, attributes: { event_type: eventType } } } } });
    event('unavailable', t0);
    event(t0, t1);
    event(t0, t1);
    event(t1, t0);
    expect(ring).toHaveBeenCalledTimes(1);
    event(t1, t2, 'door_opened');
    expect(ring).toHaveBeenCalledTimes(1);
    socket.close();
    await jest.advanceTimersByTimeAsync(1000);
    const second = FakeSocket.instances[1];
    authenticate(second);
    await flush();
    second.message({ type: 'event', id: 1, event: { data: { entity_id: entity,
      old_state: { state: t0 }, new_state: { state: t1, attributes: { event_type: 'ring' } } } } });
    expect(ring).toHaveBeenCalledTimes(1);
    await client.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('first fresh timestamp rings after unknown baseline and pre-ack events are retained', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const entity = 'event.front_door_doorbell';
    const client = new HomeAssistantClient({ url: 'https://ha.example', token: 'private-token',
      lockEntity: 'lock.front_door', ringEntity: entity,
      fetchImpl: jest.fn().mockResolvedValue(stateResponse(entity, 'unknown')),
      WebSocketImpl: FakeSocket, logger: { warn: jest.fn(), info: jest.fn() } });
    const ring = jest.fn().mockRejectedValue(new Error('callback failure'));
    const starting = client.start(ring);
    await flush();
    const socket = FakeSocket.instances[0];
    socket.message({ type: 'auth_ok' });
    const event = (oldState, timestamp) => socket.message({ type: 'event', id: 1, event: { data: {
      entity_id: entity, old_state: { state: oldState },
      new_state: { state: timestamp, attributes: { event_type: 'ring' } },
    } } });
    event('unknown', '2026-09-30T12:00:00.100Z');
    expect(ring).not.toHaveBeenCalled();
    socket.message({ type: 'result', id: 1, success: true });
    await starting;
    await flush();
    expect(ring).toHaveBeenCalledTimes(1);
    expect(client.logger.warn).toHaveBeenCalledWith('Home Assistant ring callback failed');
    event('unavailable', '2026-09-30T12:00:00.100Z');
    expect(ring).toHaveBeenCalledTimes(1);
    socket.close();
    await jest.advanceTimersByTimeAsync(1000);
    const second = FakeSocket.instances[1];
    authenticate(second);
    await flush();
    second.message({ type: 'event', id: 1, event: { data: { entity_id: entity,
      old_state: { state: 'unknown' }, new_state: { state: '2026-09-30T12:00:00.500Z',
        attributes: { event_type: 'ring' } } } } });
    expect(ring).toHaveBeenCalledTimes(1);
    await client.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('stop cancels websocket handshake and queued events', async () => {
    jest.useFakeTimers();
    const client = create(jest.fn().mockResolvedValue(stateResponse('binary_sensor.front_door_ring')));
    const ring = jest.fn();
    const stopped = expect(client.start(ring)).rejects.toThrow('event connection stopped');
    await flush();
    const socket = FakeSocket.instances[0];
    edge(socket, 'off', 'on');
    await client.stop();
    await stopped;
    authenticate(socket);
    expect(ring).not.toHaveBeenCalled();
    expect(socket.closed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('authenticates websocket and emits selected rising edges once', async () => {
    const client = create(jest.fn().mockResolvedValue(stateResponse('binary_sensor.front_door_ring')));
    const ring = jest.fn();
    const starting = client.start(ring);
    await flush();
    const socket = FakeSocket.instances[0];
    authenticate(socket);
    await starting;
    expect(socket.url).toBe('wss://ha.example/api/websocket');
    expect(socket.sent).toEqual([{ type: 'auth', access_token: 'private-token' },
      { id: 1, type: 'subscribe_events', event_type: 'state_changed' }]);
    edge(socket, 'off', 'on', 'binary_sensor.other');
    edge(socket, 'off', 'on');
    edge(socket, 'off', 'on');
    expect(ring).toHaveBeenCalledTimes(1);
    edge(socket, 'on', 'off');
    edge(socket, 'off', 'on');
    expect(ring).toHaveBeenCalledTimes(2);
    await client.stop();
    edge(socket, 'on', 'off');
    edge(socket, 'off', 'on');
    expect(ring).toHaveBeenCalledTimes(2);
    expect(socket.closed).toBe(true);
  });

  test('ignores initial on and resynchronizes after reconnect without replay', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn().mockResolvedValue(stateResponse('binary_sensor.front_door_ring', 'on'));
    const client = create(fetch);
    const ring = jest.fn();
    const starting = client.start(ring);
    await flush();
    authenticate(FakeSocket.instances[0]);
    await starting;
    edge(FakeSocket.instances[0], 'off', 'on');
    expect(ring).not.toHaveBeenCalled();
    FakeSocket.instances[0].close();
    await jest.advanceTimersByTimeAsync(1000);
    authenticate(FakeSocket.instances[1]);
    await flush();
    edge(FakeSocket.instances[1], 'off', 'on');
    expect(ring).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    await client.stop();
    await jest.advanceTimersByTimeAsync(60000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('rejects authentication without leaking server error text and stops reconnect', async () => {
    jest.useFakeTimers();
    const client = create(jest.fn().mockResolvedValue(stateResponse('binary_sensor.front_door_ring')));
    const starting = client.start(jest.fn());
    const failed = expect(starting).rejects.toThrow('event connection unavailable');
    await flush();
    FakeSocket.instances[0].message({ type: 'auth_invalid', message: 'private-token' });
    await failed;
    expect(JSON.stringify(client.logger.warn.mock.calls)).not.toContain('private-token');
    await client.stop();
    await jest.advanceTimersByTimeAsync(60000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
