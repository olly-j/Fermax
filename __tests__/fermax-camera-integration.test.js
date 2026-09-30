const fs = require('node:fs');
const http = require('node:http');
const dgram = require('node:dgram');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const hap = require('@homebridge/hap-nodejs');
const FermaxCamera = require('../src/FermaxCamera');
const HomeAssistantClient = require('../src/backend/HomeAssistantClient');

// Optional local integration: no camera, credentials, or internet required.
// Set FERMAX_TEST_FFMPEG to use an FFmpeg installation in a different location.
const ffmpegPath = [process.env.FERMAX_TEST_FFMPEG, '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg']
  .find((path) => path && fs.existsSync(path));
const integrationTest = ffmpegPath ? test : test.skip;

integrationTest('real authenticated MJPEG input produces HomeKit SRTP video and stops cleanly', async () => {
  const jpeg = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc=size=320x240:rate=25', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'],
  { timeout: 3000 });
  const token = 'local-integration-token';
  const observed = { preview: false, mediaAuthenticated: false, unauthorized: 0, packets: [] };
  const streams = new Set();
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      observed.unauthorized++;
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/api/services/button/press') {
      observed.preview = true;
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
      return;
    }
    if (request.url !== '/api/camera_proxy_stream/camera.door' || !observed.preview) {
      response.writeHead(404).end();
      return;
    }
    observed.mediaAuthenticated = true;
    response.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
    const sendFrame = () => {
      response.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      response.write(jpeg);
      response.write('\r\n');
    };
    sendFrame();
    const interval = setInterval(sendFrame, 40);
    streams.add(response);
    response.once('close', () => { clearInterval(interval); streams.delete(response); });
  });
  const receiver = dgram.createSocket('udp4');
  receiver.on('message', (packet) => observed.packets.push(packet));
  let camera;
  let client;
  let child;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve) => receiver.bind(0, '127.0.0.1', resolve));
    client = new HomeAssistantClient({ url: `http://127.0.0.1:${server.address().port}`, token,
      lockEntity: 'lock.door', cameraEntity: 'camera.door', previewEntity: 'button.preview' });
    const host = { api: { hap }, Service: hap.Service, client,
      config: { ffmpegPath, cameraStreamOptions: '-analyzeduration 0 -probesize 32 -f mpjpeg' },
      log: { warn: jest.fn(), debug: jest.fn() } };
    camera = new FermaxCamera(host, 'camera.door', {
      getService: () => new hap.Service.Doorbell('Local test'), configureController: jest.fn(),
    });
    const video = { port: receiver.address().port, srtp_key: Buffer.alloc(16, 4), srtp_salt: Buffer.alloc(14, 7),
      width: 320, height: 240, fps: 25, max_bit_rate: 200, profile: 0, level: 0, pt: 99, mtu: 1316 };
    await new Promise((resolve, reject) => camera.prepareStream({ sessionID: 'integration',
      addressVersion: 'ipv4', targetAddress: '127.0.0.1', video }, (error) => error ? reject(error) : resolve()));
    const callback = jest.fn();
    const started = new Promise((resolve, reject) => {
      callback.mockImplementation((error) => error ? reject(error) : resolve());
    });
    let deadline;
    const startupDeadline = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Real media startup exceeded four seconds')), 4000); });
    try {
      await camera.startStream('integration', { video }, callback);
      child = camera.ongoingSessions.get('integration')?.process;
      await Promise.race([started, startupDeadline]);
    } finally { clearTimeout(deadline); }
    expect(observed.preview).toBe(true);
    expect(observed.mediaAuthenticated).toBe(true);
    expect(observed.unauthorized).toBe(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(undefined);
    expect(observed.packets.length).toBeGreaterThan(0);
    const rtp = observed.packets.find((packet) => (packet[1] & 0x7f) === video.pt);
    expect(rtp).toBeDefined();
    expect(rtp[0] >> 6).toBe(2);
    expect(rtp.length).toBeGreaterThan(22); // RTP header plus SRTP authentication tag.
    const exited = once(child, 'exit');
    camera.stopStream('integration');
    const [code, signal] = await exited;
    expect(code).toBeNull();
    expect(signal).toBe('SIGKILL');
    expect(child.killed).toBe(true);
    expect(camera.ongoingSessions.size).toBe(0);
    expect(callback).toHaveBeenCalledTimes(1);
  } finally {
    camera?.dispose();
    await client?.stop();
    for (const response of streams) response.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    receiver.close();
  }
}, 10000);
