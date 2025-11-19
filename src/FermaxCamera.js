const { spawn } = require('child_process');
const {
  CameraController,
  H264Level,
  H264Profile,
  SRTPCryptoSuites,
} = require('hap-nodejs');
const { defaultFfmpegPath } = require('@homebridge/camera-utils');

const PORT_START = 40000;
const allocatedPorts = new Set();

const H264_PROFILE_NAMES = ['baseline', 'main', 'high'];
const H264_LEVEL_NAMES = ['3.1', '3.2', '4.0'];

function allocatePort() {
  for (let port = PORT_START; port < 65000; port += 1) {
    if (!allocatedPorts.has(port)) {
      allocatedPorts.add(port);
      return port;
    }
  }

  throw new Error('Unable to allocate UDP port for Fermax camera stream');
}

function releasePort(port) {
  allocatedPorts.delete(port);
}

function tokenizeArgs(input) {
  if (!input) {
    return [];
  }

  return input
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    .map((token) => token.replace(/^"(.*)"$/, '$1'));
}

class FermaxCamera {
  constructor(platform, deviceId, accessory) {
    this.platform = platform;
    this.deviceId = deviceId;
    this.accessory = accessory;
    this.streamUrl = platform.config.cameraStreamUrl;
    this.snapshotUrl = platform.config.cameraSnapshotUrl;
    this.forceTranscode = platform.config.cameraForceTranscode ?? false;
    this.maxBitrateOverride = platform.config.cameraMaxBitrate;
    this.ffmpegPath = platform.config.ffmpegPath || defaultFfmpegPath;
    this.extraInputArgs = tokenizeArgs(platform.config.cameraStreamOptions);
    this.ffmpegDebugOutput = platform.config.cameraDebug ?? false;

    this.pendingSessions = new Map();
    this.ongoingSessions = new Map();

    const streamingOptions = {
      supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
      video: {
        codec: {
          profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
          levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
        },
        resolutions: [
          [1920, 1080, 30],
          [1280, 720, 30],
          [640, 480, 30],
          [320, 240, 15],
        ],
      },
    };

    // Remove any existing camera controllers to prevent duplicates on re-initialization
    if (accessory.controllers) {
      const cameraControllers = [];
      for (const controller of accessory.controllers.values()) {
        if (controller.controllerType === 'camera') {
          cameraControllers.push(controller);
        }
      }
      for (const controller of cameraControllers) {
        accessory.removeController(controller);
      }
    }

    this.controller = new CameraController({
      delegate: this,
      cameraStreamCount: this.streamUrl ? 2 : 0,
      streamingOptions,
    });

    accessory.configureController(this.controller);
  }

  async handleSnapshotRequest(request, callback) {
    try {
      if (this.snapshotUrl) {
        const response = await fetch(this.snapshotUrl);
        if (!response.ok) {
          throw new Error(`Snapshot HTTP ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        callback(undefined, buffer);
        return;
      }

      const snapshot = await this.platform.client.getLastPicture(
        this.deviceId,
        this.platform.appToken,
      );
      if (!snapshot) {
        throw new Error('Fermax snapshot unavailable');
      }
      callback(undefined, snapshot);
    } catch (error) {
      this.platform.log.warn('Fermax snapshot failed', error.message);
      callback(error);
    }
  }

  prepareStream(request, callback) {
    const sessionId = request.sessionID;
    const video = request.video;

    const localVideoPort = allocatePort();
    const sessionInfo = {
      address: request.targetAddress,
      videoPort: video.port,
      localVideoPort,
      videoCryptoSuite: video.srtpCryptoSuite,
      videoSRTP: Buffer.concat([video.srtp_key, video.srtp_salt]),
      videoSSRC: CameraController.generateSynchronisationSource(),
    };

    const response = {
      video: {
        port: localVideoPort,
        ssrc: sessionInfo.videoSSRC,
        srtp_key: video.srtp_key,
        srtp_salt: video.srtp_salt,
      },
    };

    this.pendingSessions.set(sessionId, sessionInfo);
    callback(undefined, response);
  }

  handleStreamRequest(request, callback) {
    const sessionId = request.sessionID;

    switch (request.type) {
      case 'start':
        this.startStream(sessionId, request, callback);
        break;
      case 'reconfigure':
        this.platform.log.debug(
          'Fermax camera received reconfigure request',
          JSON.stringify(request.video),
        );
        callback();
        break;
      case 'stop':
        this.stopStream(sessionId);
        callback();
        break;
      default:
        callback(new Error(`Unsupported request type: ${request.type}`));
    }
  }

  startStream(sessionId, request, callback) {
    if (!this.streamUrl) {
      callback(new Error('cameraStreamUrl is not configured'));
      return;
    }

    const sessionInfo = this.pendingSessions.get(sessionId);
    if (!sessionInfo) {
      callback(new Error('Missing session information'));
      return;
    }

    const video = request.video;
    const profile = H264_PROFILE_NAMES[video.profile] || 'high';
    const level = H264_LEVEL_NAMES[video.level] || '4.0';
    const width = video.width;
    const height = video.height;
    const fps = video.fps;
    const payloadType = video.pt;
    const mtu = video.mtu;
    const bitrate =
      Math.min(
        video.max_bit_rate,
        this.maxBitrateOverride ?? video.max_bit_rate,
      ) || video.max_bit_rate;

    const targetAddress = sessionInfo.address;
    const targetVideoPort = sessionInfo.videoPort;
    const localVideoPort = sessionInfo.localVideoPort;
    const ssrc = sessionInfo.videoSSRC;
    const videoSRTP = sessionInfo.videoSRTP.toString('base64');

    const args = [
      '-hide_banner',
      '-loglevel',
      this.ffmpegDebugOutput ? 'info' : 'error',
      ...this.extraInputArgs,
      '-i',
      this.streamUrl,
      '-an',
      '-sn',
      '-dn',
    ];

    if (this.forceTranscode) {
      args.push(
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-r',
        `${fps}`,
        '-vf',
        `scale=${width}:${height}`,
      );
    } else {
      args.push('-vcodec', 'copy');
    }

    args.push(
      '-profile:v',
      profile,
      '-level:v',
      level,
      '-b:v',
      `${bitrate}k`,
      '-maxrate',
      `${bitrate}k`,
      '-bufsize',
      `${bitrate * 2}k`,
      '-payload_type',
      `${payloadType}`,
      '-ssrc',
      `${ssrc}`,
      '-f',
      'rtp',
      '-srtp_out_suite',
      'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params',
      videoSRTP,
      `srtp://${targetAddress}:${targetVideoPort}?rtcpport=${targetVideoPort}&localrtcpport=${localVideoPort}&pkt_size=${mtu}`,
    );

    const ffmpegProcess = spawn(this.ffmpegPath, args, { env: process.env });
    let started = false;

    ffmpegProcess.on('error', (error) => {
      this.platform.log.error('Fermax video ffmpeg error', error.message);
      this.stopStream(sessionId);
      if (!started) {
        callback(error);
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      if (this.ffmpegDebugOutput) {
        this.platform.log.debug(`[Fermax camera] ${data}`);
      }
      if (!started) {
        started = true;
        callback();
      }
    });

    ffmpegProcess.on('exit', (code, signal) => {
      this.platform.log.debug(
        `Fermax ffmpeg exited code=${code} signal=${signal}`,
      );
      this.stopStream(sessionId);
    });

    this.ongoingSessions.set(sessionId, {
      process: ffmpegProcess,
      localVideoPort,
    });
    this.pendingSessions.delete(sessionId);
  }

  stopStream(sessionId) {
    const session = this.ongoingSessions.get(sessionId);
    if (!session) {
      const pending = this.pendingSessions.get(sessionId);
      if (pending) {
        releasePort(pending.localVideoPort);
        this.pendingSessions.delete(sessionId);
      }
      return;
    }

    releasePort(session.localVideoPort);
    try {
      if (!session.process.killed) {
        session.process.kill('SIGKILL');
      }
    } catch (error) {
      this.platform.log.warn('Failed to stop Fermax ffmpeg', error.message);
    }

    this.ongoingSessions.delete(sessionId);
  }
}

module.exports = FermaxCamera;

