const {
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraController,
  H264Level,
  H264Profile,
  SRTPCryptoSuites,
} = require('hap-nodejs');

class FermaxCamera {
  constructor(platform, deviceId, accessory) {
    this.platform = platform;
    this.deviceId = deviceId;
    this.controller = new CameraController({
      delegate: this,
      cameraStreamCount: 0,
      streamingOptions: {
        supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          codec: {
            profiles: [H264Profile.BASELINE],
            levels: [H264Level.LEVEL3_1],
          },
          resolutions: [
            [640, 480, 30],
            [320, 240, 15],
          ],
        },
        audio: {
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
              bitrate: 0,
              audioChannels: 1,
            },
          ],
        },
      },
    });

    accessory.configureController(this.controller);
  }

  async handleSnapshotRequest(request, callback) {
    try {
      const snapshot = await this.platform.client.getLastPicture(
        this.deviceId,
        this.platform.appToken,
      );
      if (!snapshot) {
        callback(new Error('Fermax snapshot unavailable'));
        return;
      }
      callback(undefined, snapshot);
    } catch (error) {
      this.platform.log.warn('Fermax snapshot failed', error);
      callback(error);
    }
  }

  handleCloseConnection() {
    // Snapshot-only camera, nothing to clean up.
  }

  prepareStream(request, callback) {
    callback(new Error('Fermax live stream is not available yet.'));
  }

  handleStreamRequest() {
    // Not implemented
  }
}

module.exports = FermaxCamera;

