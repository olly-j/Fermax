jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

const { EventEmitter } = require('node:events');
const dgram = require('node:dgram');
const { spawn } = require('node:child_process');
const hap = require('@homebridge/hap-nodejs');
const FermaxCamera = require('../src/FermaxCamera');
const HomeAssistantClient = require('../src/backend/HomeAssistantClient');

function childProcess() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdio = [null, null, child.stderr, new EventEmitter()];
  child.killed = false;
  child.kill = jest.fn(() => { child.killed = true; return true; });
  return child;
}

const video = { port: 53000, srtp_key: Buffer.alloc(16, 4), srtp_salt: Buffer.alloc(14, 7),
  width: 640, height: 480, fps: 30, max_bit_rate: 300, profile: 0, level: 0, pt: 99, mtu: 1316 };

function platform(config = {}) {
  return { api: { hap }, Service: hap.Service,
    config: { cameraStreamUrl: 'rtsp://camera.test/live', ...config },
    client: {}, log: { debug: jest.fn(), warn: jest.fn() } };
}

function accessory() {
  return { getService: jest.fn(() => new hap.Service.Doorbell('Door')), configureController: jest.fn() };
}

function pending(camera, id = 'session', address = '127.0.0.1') {
  const reservation = { close: jest.fn((done) => done?.()) };
  const session = { address, videoPort: video.port, localVideoPort: 54000,
    videoSRTP: Buffer.concat([video.srtp_key, video.srtp_salt]), videoSSRC: 12345, reservation };
  camera.pendingSessions.set(id, session);
  return session;
}

describe('FermaxCamera streaming lifecycle', () => {
  let camera;
  let child;
  let host;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    host = platform();
    camera = new FermaxCamera(host, 'door', accessory());
    child = childProcess();
    spawn.mockReturnValue(child);
  });
  afterEach(() => { camera.dispose(); jest.useRealTimers(); });

  test('starts only after an encoded frame, never because stderr has diagnostics', async () => {
    pending(camera);
    const callback = jest.fn();
    await camera.startStream('session', { video }, callback);
    child.stderr.emit('data', Buffer.from('Authentication failed; private source URL'));
    child.stdio[3].emit('data', Buffer.from('frame=0\nprogress=continue\n'));
    expect(callback).not.toHaveBeenCalled();
    child.stdio[3].emit('data', Buffer.from('frame='));
    child.stdio[3].emit('data', Buffer.from('2\nprogress=continue\n'));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(undefined);
    child.stdio[3].emit('data', Buffer.from('frame=3\n'));
    camera.stopStream('session');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(camera.ongoingSessions.size).toBe(0);
  });

  test('early exit fails startup once and releases the session', async () => {
    pending(camera);
    const callback = jest.fn();
    await camera.startStream('session', { video }, callback);
    child.emit('exit', 1);
    child.emit('error', new Error('native error with private URL'));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toBe('FFmpeg exited before sending video');
    expect(camera.ongoingSessions.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('process error fails once without exposing native process details', async () => {
    pending(camera);
    const callback = jest.fn();
    await camera.startStream('session', { video }, callback);
    child.emit('error', new Error('password=secret'));
    child.emit('exit', 1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toBe('Unable to start FFmpeg');
    expect(camera.ongoingSessions.size).toBe(0);
  });

  test('exit after streaming tells HomeKit to stop without calling startup twice', async () => {
    pending(camera);
    camera.controller.forceStopStreamingSession = jest.fn();
    const callback = jest.fn();
    await camera.startStream('session', { video }, callback);
    child.stdio[3].emit('data', Buffer.from('frame=1\n'));
    child.emit('exit', 0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(camera.controller.forceStopStreamingSession).toHaveBeenCalledWith('session');
    expect(camera.ongoingSessions.size).toBe(0);
  });

  test('startup timeout kills FFmpeg and clears the active session', async () => {
    pending(camera);
    const callback = jest.fn();
    await camera.startStream('session', { video }, callback);
    jest.advanceTimersByTime(60000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toBe('Camera startup timed out');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(camera.ongoingSessions.size).toBe(0);
  });

  test('IPv6 SRTP output includes negotiated key, destination, and local RTCP port', async () => {
    const info = pending(camera, 'session', '2001:db8::1');
    host.config.cameraMaxBitrate = 200;
    await camera.startStream('session', { video }, jest.fn());
    const [binary, args, options] = spawn.mock.calls[0];
    expect(binary).toBe(camera.ffmpegPath);
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'pipe']);
    expect(args[args.indexOf('-srtp_out_params') + 1]).toBe(info.videoSRTP.toString('base64'));
    expect(args[args.indexOf('-b:v') + 1]).toBe('200k');
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=640:480');
    expect(args.at(-1)).toBe('srtp://[2001:db8::1]:53000?rtcpport=53000&localrtcpport=54000&pkt_size=1316');
    expect(info.reservation).toBeNull();
  });

  test('Home Assistant input passes bearer authentication and forces negotiated transcoding', async () => {
    const client = new HomeAssistantClient({ url: 'http://ha.test:8123', token: 'private-token',
      cameraEntity: 'camera.door', lockEntity: 'lock.door' });
    host.config.cameraStreamUrl = undefined;
    host.config.cameraForceTranscode = false;
    host.config.cameraDebug = true;
    host.client = client;
    pending(camera);
    await camera.startStream('session', { video }, jest.fn());
    const args = spawn.mock.calls[0][1];
    expect(args[args.indexOf('-headers') + 1]).toBe('Authorization: Bearer private-token\r\n');
    expect(args[args.indexOf('-i') + 1]).toBe('http://ha.test:8123/api/camera_proxy_stream/camera.door');
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    child.stderr.emit('data', Buffer.from('Bearer private-token at http://ha.test:8123'));
    expect(host.log.debug).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(host.log.debug.mock.calls)).not.toContain('private-token');
    expect(JSON.stringify(host.log.debug.mock.calls)).not.toContain('ha.test');
  });

  test('stopping while video source resolves prevents starting a process', async () => {
    let resolveSource;
    host.config.cameraStreamUrl = undefined;
    host.client.getVideoSource = jest.fn(() => new Promise((resolve) => { resolveSource = resolve; }));
    const info = pending(camera);
    const socket = info.reservation;
    const callback = jest.fn();
    const starting = camera.startStream('session', { video }, callback);
    camera.stopStream('session');
    resolveSource({ url: 'rtsp://camera.test/live' });
    await starting;
    expect(spawn).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toBe('Camera stream stopped');
  });

  test('stop during port closure never starts an orphan process or closes the port twice', async () => {
    const info = pending(camera);
    const socket = info.reservation;
    let completeClose;
    socket.close.mockImplementation((done) => { completeClose = done; });
    const callback = jest.fn();
    const starting = camera.startStream('session', { video }, callback);
    expect(socket.close).toHaveBeenCalledTimes(1);
    camera.stopStream('session');
    expect(socket.close).toHaveBeenCalledTimes(1);
    completeClose();
    await starting;
    expect(spawn).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toBe('Camera stream stopped');
    expect(camera.ongoingSessions.size).toBe(0);
  });

  test('missing media source fails once and closes its reserved port', async () => {
    host.config.cameraStreamUrl = undefined;
    const info = pending(camera);
    const callback = jest.fn();
    await camera.startStream('session', { video }, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].message).toContain('Fermax live video unavailable');
    expect(info.reservation.close).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(camera.ongoingSessions.size).toBe(0);
  });

  test('dispose releases pending and active sessions and rejects subsequent prepare', async () => {
    const pendingInfo = pending(camera, 'pending');
    pending(camera, 'active');
    const callback = jest.fn();
    await camera.startStream('active', { video }, callback);
    camera.dispose();
    camera.dispose();
    expect(pendingInfo.reservation.close).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(camera.pendingSessions.size).toBe(0);
    expect(camera.ongoingSessions.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    const prepare = jest.fn();
    await camera.prepareStream({ sessionID: 'new' }, prepare);
    expect(prepare.mock.calls[0][0].message).toBe('Camera stopped');
  });
});

describe('FermaxCamera real UDP reservation', () => {
  test.each(['stop', 'dispose'])('canceling prepare via %s while binding releases the real socket', async (action) => {
    const camera = new FermaxCamera(platform(), 'door', accessory());
    const createSocket = dgram.createSocket;
    const sockets = [];
    const create = jest.spyOn(dgram, 'createSocket').mockImplementation((...args) => {
      const socket = createSocket(...args);
      sockets.push(socket);
      return socket;
    });
    const callback = jest.fn();
    try {
      const preparing = camera.prepareStream({ sessionID: 'cancel', addressVersion: 'ipv4',
        targetAddress: '127.0.0.1', video }, callback);
      if (action === 'stop') camera.stopStream('cancel');
      else camera.dispose();
      await preparing;
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(camera.pendingSessions.size).toBe(0);
      expect(() => sockets[0].address()).toThrow();
    } finally {
      camera.dispose();
      create.mockRestore();
      for (const socket of sockets) { try { socket.close(); } catch { /* already closed */ } }
    }
  });

  test('concurrent preparation for one session retains only the newest real port', async () => {
    const camera = new FermaxCamera(platform(), 'door', accessory());
    const createSocket = dgram.createSocket;
    const sockets = [];
    const create = jest.spyOn(dgram, 'createSocket').mockImplementation((...args) => {
      const socket = createSocket(...args);
      sockets.push(socket);
      return socket;
    });
    const first = jest.fn();
    const second = jest.fn();
    const request = { sessionID: 'replace', addressVersion: 'ipv4', targetAddress: '127.0.0.1', video };
    try {
      const earlier = camera.prepareStream(request, first);
      const latest = camera.prepareStream(request, second);
      await Promise.all([earlier, latest]);
      expect(first).toHaveBeenCalledTimes(1);
      expect(first.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(second).toHaveBeenCalledTimes(1);
      expect(second.mock.calls[0][0]).toBeUndefined();
      expect(() => sockets[0].address()).toThrow();
      expect(camera.pendingSessions.size).toBe(1);
      expect(camera.pendingSessions.get('replace').localVideoPort).toBe(second.mock.calls[0][1].video.port);
      expect(sockets[1].address().port).toBe(second.mock.calls[0][1].video.port);
    } finally {
      camera.dispose();
      create.mockRestore();
      for (const socket of sockets) { try { socket.close(); } catch { /* already closed */ } }
    }
  });

  test('prepare binds a live UDP port, returns SRTP parameters, and releases the port on stop', async () => {
    const camera = new FermaxCamera(platform(), 'door', accessory());
    const probe = dgram.createSocket('udp4');
    try {
      const response = await new Promise((resolve, reject) => camera.prepareStream({ sessionID: 'real',
        addressVersion: 'ipv4', targetAddress: '127.0.0.1', video }, (error, result) => error ? reject(error) : resolve(result)));
      expect(response.video.port).toBeGreaterThan(0);
      expect(response.video.ssrc).toEqual(expect.any(Number));
      expect(response.video.srtp_key).toEqual(video.srtp_key);
      expect(response.video.srtp_salt).toEqual(video.srtp_salt);
      expect(camera.pendingSessions.get('real').reservation.address().port).toBe(response.video.port);
      const reserved = camera.pendingSessions.get('real').reservation;
      const closed = new Promise((resolve) => reserved.once('close', resolve));
      camera.stopStream('real');
      await closed;
      await new Promise((resolve, reject) => { probe.once('error', reject); probe.bind(response.video.port, resolve); });
      expect(probe.address().port).toBe(response.video.port);
    } finally {
      camera.dispose();
      try { probe.close(); } catch { /* not bound */ }
    }
  });
});
