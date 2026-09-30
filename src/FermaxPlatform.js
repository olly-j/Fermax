const FermaxClient = require('./api/FermaxClient');
const FermaxPushClient = require('./push/FermaxPushClient');
const FermaxAccessory = require('./FermaxAccessory');
const HomeAssistantClient = require('./backend/HomeAssistantClient');
const { validateConfiguration } = require('./configuration');

const PLATFORM_NAME = 'FermaxBluePlatform';
const PLUGIN_NAME = 'homebridge-fermax-blue';

class FermaxBluePlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = new Map();
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.deviceContext = null;
    this.appToken = null;
    this.client = null;
    this.pushClient = null;
    this.stopped = false;
    this.notificationIds = new Set();

    if (!config) {
      this.log.warn('Fermax Blue platform is not configured.');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.initializeWithRetry();
    });

    this.api.on('shutdown', async () => {
      this.stopped = true;
      clearTimeout(this.retryTimer);
      clearTimeout(this.pushRetryTimer);
      await this.client?.stop?.();
      await this.pushClient?.stop();
      this.fermaxAccessory?.dispose?.();
    });
  }

  configureAccessory(accessory) {
    this.log.info('Loaded cached Fermax accessory', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async initializeWithRetry(attempt = 1) {
    if (this.stopped) return;
    try {
      await this.initialize();
    } catch (error) {
      const delay = Math.min(10 * 1000 * Math.pow(2, attempt - 1), 60 * 60 * 1000); // Max 1 hour
      this.log.error(`Fermax initialization failed (retrying in ${delay / 1000}s):`, error.message);
      if (!this.stopped) this.retryTimer = setTimeout(() => this.initializeWithRetry(attempt + 1), delay);
    }
  }

  async initialize() {
    if (this.stopped) return;
    validateConfiguration(this.config);
    if (this.config.backend === 'homeassistant') {
      if (this.config.homeAssistantPreviewEntity && (!this.config.homeAssistantCameraEntity || this.config.cameraStreamUrl)) {
        this.log.warn('Home Assistant preview button is unused without an HA camera stream. Clear it or use the selected HA camera for video.');
      }
      if (!this.client) this.client = new HomeAssistantClient({
        url: this.config.homeAssistantUrl,
        token: this.config.homeAssistantToken,
        cameraEntity: this.config.homeAssistantCameraEntity,
        lockEntity: this.config.homeAssistantLockEntity,
        ringEntity: this.config.homeAssistantRingEntity,
        previewEntity: this.config.homeAssistantCameraEntity && !this.config.cameraStreamUrl
          ? this.config.homeAssistantPreviewEntity : undefined,
        logger: this.log,
      });
      await this.syncDevices();
      if (this.stopped) return;
      await this.client.start(() => this.fermaxAccessory?.triggerDoorbell());
      return;
    }
    if (!this.config.username || !this.config.password) {
      this.log.error('Fermax Blue configuration missing username or password.');
      return;
    }
    if (!this.client) this.client = new FermaxClient({
      username: this.config.username,
      password: this.config.password,
      dataDir: this.api.user.storagePath(),
      logger: this.log,
      clientId: this.config.clientId || undefined,
      clientSecret: this.config.clientSecret || undefined,
      authUrl: this.config.fermaxAuthUrl || undefined,
      baseUrl: this.config.fermaxBaseUrl || undefined,
    });
    const pushFields = ['firebaseProjectId', 'firebaseAppId', 'firebaseApiKey'];
    const configured = pushFields.filter((key) => this.config[key]);
    if ((configured.length || this.config.senderId || this.config.firebaseVapidKey) && configured.length !== pushFields.length) {
      this.log.warn('Direct push requires firebaseProjectId, firebaseAppId and firebaseApiKey. Unlock remains available; use Home Assistant for the maintained Fermax video/push route.');
    } else if (configured.length && !this.pushClient) {
      this.pushClient = new FermaxPushClient({
        senderId: this.config.senderId,
        projectId: this.config.firebaseProjectId,
        appId: this.config.firebaseAppId,
        apiKey: this.config.firebaseApiKey,
        vapidKey: this.config.firebaseVapidKey,
        username: this.config.username,
        dataDir: this.api.user.storagePath(),
        logger: this.log,
      });
    }
    await this.syncDevices();
    if (this.pushClient) await this.startPushListener();
  }

  async syncDevices() {
    const pairings = await this.client.getPairings();
    if (this.stopped) return;
    if (!pairings?.length) {
      throw new Error('Fermax account has no paired devices');
    }

    const selection = this.config.backend === 'homeassistant' ? {} : this.config;
    const hasSelector = selection.deviceId || selection.deviceTag;
    const candidates = pairings.filter((pairing) =>
      (!selection.deviceId || pairing.deviceId === selection.deviceId) &&
      (!selection.deviceTag || pairing.tag === selection.deviceTag));
    if (hasSelector && candidates.length !== 1) {
      throw new Error('Configured Fermax device does not match exactly one pairing.');
    }
    if (!hasSelector && pairings.length !== 1) {
      throw new Error('Multiple Fermax devices found; set deviceId explicitly.');
    }
    const targetDevice = candidates[0];
    if (!targetDevice?.deviceId) throw new Error('Pairing has no deviceId.');
    const doors = Object.entries(targetDevice.accessDoorMap || {});
    if (!doors.length) throw new Error('Fermax device does not expose any access doors.');
    const index = selection.doorIndex ?? 0;
    if (!Number.isInteger(index) || index < 0) throw new Error('doorIndex must be a nonnegative integer.');
    if (!selection.accessDoorKey && selection.doorIndex === undefined && doors.length > 1) {
      throw new Error('Multiple access doors found; set accessDoorKey or doorIndex explicitly.');
    }
    const doorEntry = selection.accessDoorKey
      ? doors.find(([key]) => key === selection.accessDoorKey) : doors[index];
    if (!doorEntry) throw new Error('Configured access door was not found.');
    const [doorKey, doorDetails] = doorEntry;
    const doorAccess = doorDetails.accessId || doorDetails;

    if (this.config.backend !== 'homeassistant' && !['block', 'subblock', 'number'].every((key) => Number.isInteger(doorAccess[key]) && doorAccess[key] >= 0)) {
      throw new Error('Access door address is invalid.');
    }
    this.deviceContext = {
      deviceId: targetDevice.deviceId,
      doorKey,
      door: this.config.backend === 'homeassistant' ? doorAccess : {
        block: doorAccess.block,
        subblock: doorAccess.subblock,
        number: doorAccess.number,
      },
      name: this.config.name || targetDevice.tag || 'Fermax Door',
    };

    const uuid = this.api.hap.uuid.generate(this.deviceContext.deviceId);
    let accessory = this.accessories.get(uuid);
    if (!accessory) {
      accessory = new this.api.platformAccessory(
        this.deviceContext.name,
        uuid,
      );
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
      this.accessories.set(uuid, accessory);
    }

    if (this.fermaxAccessory) return;
    for (const [cachedUuid, cachedAccessory] of this.accessories) {
      if (cachedUuid !== uuid) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
        this.accessories.delete(cachedUuid);
      }
    }
    accessory.context = this.deviceContext;
    this.api.updatePlatformAccessories?.([accessory]);
    this.fermaxAccessory = new FermaxAccessory(
      this,
      accessory,
      accessory.context,
    );
  }

  async startPushListener(attempt = 1) {
    if (this.stopped) return;
    try {
      this.pushClient.tokenChanged = async (token) => {
        await this.client.registerAppToken(token, true);
        this.appToken = token;
      };
      this.appToken = await this.pushClient.start((message) =>
        this.handleNotification(message),
      );
      if (this.stopped) { await this.pushClient.stop(); return; }
      await this.client.registerAppToken(this.appToken, true);
      if (this.stopped) { await this.pushClient.stop(); return; }
      clearTimeout(this.pushRetryTimer);
      this.log.info('Fermax Blue notifications ready');
    } catch {
      await this.pushClient.stop();
      this.log.warn('Fermax push unavailable; retry scheduled. Door control remains available.');
      if (!this.stopped) this.pushRetryTimer = setTimeout(() => this.startPushListener(attempt + 1), Math.min(10000 * 2 ** (attempt - 1), 300000));
    }
  }

  handleNotification(message) {
    try {
      const payload = this.parseFermaxNotification(message?.message ?? message?.notification ?? message);
      if (!payload) {
        return;
      }
      if (payload.DeviceId !== this.deviceContext?.deviceId) {
        return;
      }
      if (payload.FermaxNotificationType === 'Call') {
        const envelope = message?.message ?? message?.notification ?? message;
        const id = message?.persistentId ?? envelope?.fcmMessageId ?? envelope?.messageId ?? envelope?.message_id;
        if (id && this.notificationIds.has(id)) return;
        if (id) {
          this.notificationIds.add(id);
          if (this.notificationIds.size > 100) this.notificationIds.delete(this.notificationIds.values().next().value);
        }
        // Ringing must not mark the call as attended; the phone can still answer.
        this.fermaxAccessory?.triggerDoorbell(payload);
      }
    } catch {
      this.log.warn('Failed to parse Fermax notification');
    }
  }

  parseFermaxNotification(notification) {
    if (!notification) {
      return null;
    }
    let data = notification.data ?? notification.notification ?? notification;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        this.log.warn('Fermax notification JSON parse failed');
        return null;
      }
    }
    if (data?.FermaxNotificationType) {
      return data;
    }
    if (data?.data && data.data.FermaxNotificationType) {
      return data.data;
    }
    return null;
  }
}

module.exports = FermaxBluePlatform;
