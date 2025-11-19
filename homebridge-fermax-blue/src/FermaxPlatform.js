const FermaxClient = require('./api/FermaxClient');
const FermaxPushClient = require('./push/FermaxPushClient');
const FermaxAccessory = require('./FermaxAccessory');

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

    if (!config) {
      this.log.warn('Fermax Blue platform is not configured.');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.initialize().catch((error) => {
        this.log.error('Fermax initialization failed', error);
      });
    });

    this.api.on('shutdown', async () => {
      await this.pushClient?.stop();
    });
  }

  configureAccessory(accessory) {
    this.log.info('Loaded cached Fermax accessory', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async initialize() {
    if (!this.config.username || !this.config.password || !this.config.senderId) {
      this.log.error(
        'Fermax Blue configuration missing username, password or senderId.',
      );
      return;
    }

    this.client = new FermaxClient({
      username: this.config.username,
      password: this.config.password,
      dataDir: this.api.user.storagePath(),
      logger: this.log,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });

    this.pushClient = new FermaxPushClient({
      senderId: this.config.senderId,
      dataDir: this.api.user.storagePath(),
      logger: this.log,
    });

    await this.retryInitialize();
  }

  async retryInitialize(delay = 5000) {
    try {
      await this.syncDevices();
      await this.startPushListener();
    } catch (error) {
      this.log.warn(`Fermax initialization failed (retrying in ${delay / 1000}s):`, error.message);
      setTimeout(() => this.retryInitialize(Math.min(delay * 2, 300000)), delay);
    }
  }

  async syncDevices() {
    const pairings = await this.client.getPairings();
    if (!pairings?.length) {
      throw new Error('Fermax account has no paired devices');
    }

    const targetDevice =
      pairings.find(
        (pairing) =>
          pairing.deviceId === this.config.deviceId ||
          pairing.tag === this.config.deviceTag,
      ) || pairings[0];

    const doors = Object.entries(targetDevice.accessDoorMap || {});
    if (!doors.length) {
      throw new Error('Fermax device does not expose any access doors.');
    }

    const doorEntry =
      doors.find(([key]) => key === this.config.accessDoorKey) ||
      doors[this.config.doorIndex || 0];

    const [doorKey, doorDetails] = doorEntry;
    const doorAccess = doorDetails.accessId || doorDetails;

    this.deviceContext = {
      deviceId: targetDevice.deviceId,
      doorKey,
      door: {
        block: doorAccess.block,
        subblock: doorAccess.subblock,
        number: doorAccess.number,
      },
      name: targetDevice.tag || 'Fermax Door',
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

    accessory.context = this.deviceContext;
    this.fermaxAccessory = new FermaxAccessory(
      this,
      accessory,
      accessory.context,
    );
  }

  async startPushListener() {
    this.appToken = await this.pushClient.start((message) =>
      this.handleNotification(message),
    );
    await this.client.registerAppToken(this.appToken, true);
    this.log.info('Fermax Blue notifications ready');
  }

  handleNotification(message) {
    try {
      const payload = this.parseFermaxNotification(message?.notification);
      if (!payload) {
        return;
      }
      if (payload.DeviceId !== this.deviceContext?.deviceId) {
        return;
      }
      if (payload.FermaxNotificationType === 'Call') {
        if (message?.notification?.messageId || message?.notification?.message_id) {
          this.client
            .acknowledgeNotification(
              message.notification.messageId ?? message.notification.message_id,
            )
            .catch((error) =>
              this.log.warn('Fermax ack failed', error.message),
            );
        }
        this.fermaxAccessory?.triggerDoorbell(payload);
      }
    } catch (error) {
      this.log.warn('Failed to parse Fermax notification', error);
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
      } catch (error) {
        this.log.warn('Fermax notification JSON parse failed', error);
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

