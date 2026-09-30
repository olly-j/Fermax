const { spawn } = require('node:child_process');
const dgram = require('node:dgram');
const defaultFfmpegPath = require('ffmpeg-for-homebridge') || 'ffmpeg';
const { DEFAULT_CAMERA_MAX_BITRATE } = require('./configuration');

function tokenizeArgs(input) {
  return (input?.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((token) => token.replace(/^"(.*)"$/, '$1'));
}

class FermaxCamera {
  constructor(platform, deviceId, accessory) {
    this.platform = platform;
    this.deviceId = deviceId;
    this.accessory = accessory;
    this.hap = platform.api.hap;
    this.ffmpegPath = platform.config.ffmpegPath || defaultFfmpegPath;
    this.pendingSessions = new Map();
    this.preparingSessions = new Map();
    this.ongoingSessions = new Map();
    this.disposed = false;
    const { DoorbellController, H264Profile, H264Level, SRTPCryptoSuites } = this.hap;
    this.controller = new DoorbellController({
      externalDoorbellService: accessory.getService(platform.Service.Doorbell),
      cameraStreamCount: 2,
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: { profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH], levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0] },
          resolutions: [[1280, 720, 30], [720, 480, 25], [640, 480, 30], [320, 240, 15]],
        },
      },
    });
    accessory.configureController(this.controller);
  }

  async handleSnapshotRequest(_request, callback) {
    try {
      let snapshot;
      if (this.platform.config.cameraSnapshotUrl) {
        const response = await fetch(this.platform.config.cameraSnapshotUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
        snapshot = Buffer.from(await response.arrayBuffer());
      } else {
        snapshot = await this.platform.client.getLastPicture(this.deviceId, this.platform.appToken);
      }
      if (!snapshot?.length) throw new Error('Fermax snapshot unavailable');
      callback(undefined, snapshot);
    } catch {
      this.platform.log.warn('Fermax snapshot unavailable');
      callback(new Error('Fermax snapshot unavailable'));
    }
  }

  async prepareStream(request, callback) {
    if (this.disposed) return callback(new Error('Camera stopped'));
    this.stopStream(request.sessionID);
    const generation = Symbol();
    this.preparingSessions.set(request.sessionID, generation);
    const socket = dgram.createSocket(request.addressVersion === 'ipv6' ? 'udp6' : 'udp4');
    try {
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, resolve);
      });
      if (this.disposed || this.preparingSessions.get(request.sessionID) !== generation) {
        socket.close(); return callback(new Error('Camera stopped'));
      }
      this.preparingSessions.delete(request.sessionID);
      const video = request.video;
      const session = {
        address: request.targetAddress,
        videoPort: video.port,
        localVideoPort: socket.address().port,
        reservation: socket,
        videoSRTP: Buffer.concat([video.srtp_key, video.srtp_salt]),
        videoSSRC: this.hap.CameraController.generateSynchronisationSource(),
      };
      session.expiry = setTimeout(() => this.stopStream(request.sessionID), 60000);
      this.pendingSessions.set(request.sessionID, session);
      callback(undefined, { video: { port: session.localVideoPort, ssrc: session.videoSSRC, srtp_key: video.srtp_key, srtp_salt: video.srtp_salt } });
    } catch {
      try { socket.close(); } catch { /* Already closed */ }
      callback(new Error('Unable to reserve camera port'));
    }
  }

  handleStreamRequest(request, callback) {
    if (request.type === 'stop') { this.stopStream(request.sessionID); callback(); }
    else if (request.type === 'start') { this.startStream(request.sessionID, request, callback); }
    else if (request.type === 'reconfigure') {
      // Restart with the negotiated dimensions and bitrate, retaining SRTP parameters.
      const previous = this.ongoingSessions.get(request.sessionID);
      if (!previous) return callback(new Error('Missing stream session'));
      const session = previous.info;
      this.stopStream(request.sessionID);
      this.pendingSessions.set(request.sessionID, session);
      this.startStream(request.sessionID, request, callback);
    } else callback(new Error('Unsupported camera request'));
  }

  async startStream(sessionId, request, callback) {
    const session = this.pendingSessions.get(sessionId);
    if (!session || this.disposed) return callback(new Error('Missing stream session'));
    this.pendingSessions.delete(sessionId);
    clearTimeout(session.expiry);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(active.timeout);
      callback(error);
    };
    const active = { info: session, process: null, finish, timeout: null };
    this.ongoingSessions.set(sessionId, active);
    active.timeout = setTimeout(() => {
      finish(new Error('Camera startup timed out'));
      this.stopStream(sessionId);
    }, 60000);
    try {
      let source = { url: this.platform.config.cameraStreamUrl, inputArgs: [] };
      if (!source.url && this.platform.client.getVideoSource) source = await this.platform.client.getVideoSource();
      if (!source.url) throw new Error('No live video source is configured');
      if (this.ongoingSessions.get(sessionId) !== active) return;
      if (session.reservation) {
        const reservation = session.reservation;
        session.reservation = null;
        await new Promise((resolve) => reservation.close(resolve));
      }
      if (this.ongoingSessions.get(sessionId) !== active || this.disposed) return;
      const video = request.video;
      const bitrate = Math.min(video.max_bit_rate, this.platform.config.cameraMaxBitrate ?? DEFAULT_CAMERA_MAX_BITRATE);
      const address = session.address.includes(':') ? `[${session.address}]` : session.address;
      const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:3',
        ...tokenizeArgs(this.platform.config.cameraStreamOptions), ...(source.inputArgs || []), '-i', source.url, '-an', '-sn', '-dn'];
      // Transcode by default to honor the HomeKit negotiated stream parameters.
      if (this.platform.config.cameraForceTranscode !== false || source.forceTranscode) {
        args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-tune', 'zerolatency',
          '-r', `${video.fps}`, '-vf', `scale=${video.width}:${video.height}`,
          '-profile:v', ['baseline', 'main', 'high'][video.profile] || 'baseline',
          '-level:v', ['3.1', '3.2', '4.0'][video.level] || '3.1',
          '-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`);
      } else args.push('-c:v', 'copy');
      args.push('-payload_type', `${video.pt}`, '-ssrc', `${session.videoSSRC}`, '-f', 'rtp',
        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80', '-srtp_out_params', session.videoSRTP.toString('base64'),
        `srtp://${address}:${session.videoPort}?rtcpport=${session.videoPort}&localrtcpport=${session.localVideoPort}&pkt_size=${video.mtu}`);
      const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
      active.process = child;
      let progress = '';
      child.stdio[3].on('data', (chunk) => {
        progress = (progress + chunk.toString()).slice(-8192);
        if (/(?:^|\n)frame=\s*[1-9]\d*(?:\r?\n|$)/.test(progress)) finish();
      });
      child.stderr.on('data', () => {
        if (this.platform.config.cameraDebug) this.platform.log.debug('Fermax FFmpeg reported diagnostic output (media credentials withheld)');
      });
      child.on('error', () => { if (this.ongoingSessions.get(sessionId) !== active) return; finish(new Error('Unable to start FFmpeg')); this.stopStream(sessionId); });
      child.on('exit', () => {
        if (this.ongoingSessions.get(sessionId) !== active) return;
        const wasStreaming = settled;
        finish(new Error('FFmpeg exited before sending video'));
        this.stopStream(sessionId);
        if (wasStreaming) this.controller.forceStopStreamingSession?.(sessionId);
      });
    } catch {
      finish(new Error('Fermax live video unavailable; check media setup'));
      this.stopStream(sessionId);
    }
  }

  stopStream(sessionId) {
    this.preparingSessions.delete(sessionId);
    const pending = this.pendingSessions.get(sessionId);
    if (pending) {
      clearTimeout(pending.expiry);
      pending.reservation?.close();
      this.pendingSessions.delete(sessionId);
    }
    const active = this.ongoingSessions.get(sessionId);
    if (!active) return;
    this.ongoingSessions.delete(sessionId);
    clearTimeout(active.timeout);
    active.finish(new Error('Camera stream stopped'));
    active.info.reservation?.close();
    if (active.process && !active.process.killed) active.process.kill('SIGKILL');
  }

  dispose() {
    this.disposed = true;
    this.preparingSessions.clear();
    for (const id of [...this.pendingSessions.keys(), ...this.ongoingSessions.keys()]) this.stopStream(id);
  }
}
module.exports = FermaxCamera;
