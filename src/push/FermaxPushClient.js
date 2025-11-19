const { listen, register } = require('push-receiver-v2');
const FileStore = require('../storage/FileStore');

class FermaxPushClient {
  constructor({ senderId, dataDir, logger }) {
    if (!senderId) {
      throw new Error('Fermax senderId is required for push notifications');
    }
    this.senderId = senderId;
    this.logger = logger;
    this.credentialsStore = new FileStore(dataDir, 'fcm-credentials.json');
    this.persistentStore = new FileStore(dataDir, 'fcm-persistent.json');
    this.client = null;
    this.credentials = null;
  }

  async start(onNotification) {
    this.credentials = await this._ensureCredentials();
    const persistentIds = (await this.persistentStore.read([])) ?? [];

    this.client = await listen(
      {
        ...this.credentials,
        persistentIds,
      },
      async (message) => {
        await this._handleNotification(message, onNotification);
      },
    );

    this.logger?.info?.('Fermax push listener started');
    return this.credentials.fcm.token;
  }

  async stop() {
    if (this.client?.destroy) {
      this.client.destroy();
      this.client = null;
      this.logger?.info?.('Fermax push listener stopped');
    }
  }

  async _ensureCredentials() {
    const cached = await this.credentialsStore.read();
    if (cached?.fcm?.token) {
      return cached;
    }
    this.logger?.info?.('Registering Fermax FCM token...');
    const creds = await register(this.senderId);
    await this.credentialsStore.write(creds);
    return creds;
  }

  async _handleNotification(message, onNotification) {
    const { persistentId } = message;
    if (persistentId) {
      const stored = (await this.persistentStore.read([])) ?? [];
      if (!stored.includes(persistentId)) {
        stored.push(persistentId);
        await this.persistentStore.write(stored.slice(-100));
      }
    }
    onNotification?.(message);
  }
}

module.exports = FermaxPushClient;

