const { createHash } = require('node:crypto');
const { PushReceiver } = require('@eneris/push-receiver');
const FileStore = require('../storage/FileStore');

class FermaxPushClient {
  constructor({ senderId, projectId, appId, apiKey, vapidKey = '', username, dataDir, logger }) {
    if (![senderId, projectId, appId, apiKey].every((value) => typeof value === 'string' && value)) {
      throw new Error('Direct push requires all four Firebase client configuration fields.');
    }
    this.firebase = { messagingSenderId: senderId, projectId, appId, apiKey };
    this.vapidKey = vapidKey;
    this.logger = logger;
    const scope = createHash('sha256').update(JSON.stringify([username, this.firebase, vapidKey])).digest('hex').slice(0, 24);
    this.credentialsStore = new FileStore(dataDir, `fermax-fcm-${scope}.json`);
    this.persistentStore = new FileStore(dataDir, `fermax-fcm-ids-${scope}.json`);
    this.client = null;
    this.queue = Promise.resolve();
    this.stopped = true;
    this.startup = null;
    this.generation = 0;
  }

  async start(onNotification) {
    const stopping = this.stop();
    const generation = this.generation;
    await stopping;
    if (generation !== this.generation) throw new Error('Push startup stopped');
    this.stopped = false;
    const credentials = await this.credentialsStore.read();
    const stored = await this.persistentStore.read([]);
    this.ids = new Set(Array.isArray(stored) ? stored.slice(-100) : []);
    if (this.stopped || generation !== this.generation) throw new Error('Push startup stopped');
    const client = new PushReceiver({
      firebase: this.firebase,
      vapidKey: this.vapidKey,
      credentials: credentials || undefined,
      persistentIds: [...this.ids],
      debug: false,
    });
    this.client = client;
    client.onCredentialsChanged(({ newCredentials }) => {
      this.queue = this.queue.then(async () => {
        if (this.stopped || client !== this.client) return;
        await this.credentialsStore.write(newCredentials);
        if (!this.stopped && client === this.client && this.tokenChanged) {
          await this.tokenChanged(newCredentials.fcm.token);
        }
      }).catch(() => this.logger?.warn?.('Unable to persist or register updated push credentials'));
    });
    client.onNotification((message) => {
      this.queue = this.queue.then(async () => {
        if (this.stopped || client !== this.client) return;
        const id = message?.persistentId;
        if (id && this.ids.has(id)) return;
        await onNotification?.(message);
        if (id) {
          this.ids.add(id);
          if (this.ids.size > 100) this.ids.delete(this.ids.values().next().value);
        }
        if (id) await this.persistentStore.write([...this.ids]);
      }).catch(() => this.logger?.warn?.('Fermax push delivery or persistence failed'));
    });
    const startup = { timer: null, cancel: null };
    this.startup = startup;
    const cancelled = new Promise((_, reject) => {
      startup.cancel = () => reject(new Error('Push startup stopped'));
      startup.timer = setTimeout(() => reject(new Error('Push connection timed out')), 30000);
    });
    try {
      // A receiver may finish opening its socket after destroy() cancelled a
      // pending registration. Close it again rather than resurrecting a listener.
      const connected = Promise.resolve().then(() => {
        if (this.stopped || client !== this.client) throw new Error('Push startup stopped');
        return client.connect();
      }).then(() => {
        if (this.stopped || client !== this.client) client.destroy();
      });
      await Promise.race([
        connected,
        cancelled,
      ]);
      await Promise.race([this.queue, cancelled]);
      if (this.stopped || client !== this.client) throw new Error('Push startup stopped');
      if (!client.fcmToken) throw new Error('Push registration returned no token');
      this.logger?.info?.('Fermax push listener connected');
      return client.fcmToken;
    } catch (error) {
      // An older cancelled startup must not stop a newer receiver.
      if (client === this.client) await this.stop();
      throw error;
    } finally {
      clearTimeout(startup.timer);
      if (this.startup === startup) this.startup = null;
    }
  }

  async stop() {
    this.stopped = true;
    this.generation += 1;
    const startup = this.startup;
    this.startup = null;
    clearTimeout(startup?.timer);
    startup?.cancel?.();
    this.client?.destroy();
    this.client = null;
    await this.queue;
  }
}
module.exports = FermaxPushClient;
