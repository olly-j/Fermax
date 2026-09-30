const DEFAULT_UNLOCK_RESET_SECONDS = 8;
const DEFAULT_CAMERA_MAX_BITRATE = 2000;

// Validate saved JSON too: the Homebridge form is not the only configuration path.
function validateConfiguration(config) {
  if (!['direct', 'homeassistant'].includes(config.backend ?? 'direct')) {
    throw new Error('backend must be direct or homeassistant');
  }
  for (const [key, minimum, maximum] of [
    ['unlockResetSeconds', 1, 60],
    ['cameraMaxBitrate', 500, 10000],
  ]) {
    if (config[key] !== undefined && (!Number.isInteger(config[key]) || config[key] < minimum || config[key] > maximum)) {
      throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`);
    }
  }
  if (config.backend !== 'homeassistant' && Boolean(config.clientId) !== Boolean(config.clientSecret)) {
    throw new Error('Custom OAuth credentials require both clientId and clientSecret.');
  }
  for (const key of ['cameraForceTranscode', 'cameraDebug']) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`${key} must be true or false.`);
    }
  }
  if (config.cameraStreamOptions !== undefined && typeof config.cameraStreamOptions !== 'string') {
    throw new Error('cameraStreamOptions must be a string.');
  }
  if (config.cameraSnapshotUrl) {
    let url;
    try { url = new URL(config.cameraSnapshotUrl); } catch { throw new Error('cameraSnapshotUrl must be an HTTP or HTTPS URL.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('cameraSnapshotUrl must be an HTTP or HTTPS URL.');
  }
}

function hasCameraCapability(config) {
  return Boolean(config.cameraStreamUrl || config.cameraSnapshotUrl ||
    (config.backend === 'homeassistant' && config.homeAssistantCameraEntity) ||
    (config.backend !== 'homeassistant' && config.firebaseProjectId && config.firebaseAppId && config.firebaseApiKey));
}

module.exports = { validateConfiguration, hasCameraCapability, DEFAULT_UNLOCK_RESET_SECONDS, DEFAULT_CAMERA_MAX_BITRATE };
