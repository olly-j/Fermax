const ENTITY_PATTERNS = {
  camera: /^camera\.[a-z0-9_]+$/,
  lock: /^lock\.[a-z0-9_]+$/,
  ring: /^(?:event|binary_sensor|input_boolean)\.[a-z0-9_]+$/,
  preview: /^button\.[a-z0-9_]+$/,
};

// Home Assistant supplies an existing camera and ring sensor. This adapter
// does not create Fermax video, add audio, or guarantee delivery during outages.
class HomeAssistantClient {
  constructor({ url, token, cameraEntity, lockEntity, ringEntity, previewEntity, logger,
    fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket,
    requestTimeoutMs = 10000, reconnectDelayMs = 1000 }) {
    const base = new URL(url);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
        base.search || base.hash || !['', '/'].includes(base.pathname)) {
      throw new Error('Home Assistant URL must be an HTTP(S) server origin without credentials');
    }
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
      throw new Error('Home Assistant access token is required');
    }
    for (const [kind, value] of Object.entries({ camera: cameraEntity, lock: lockEntity, ring: ringEntity, preview: previewEntity })) {
      if (value !== undefined && value !== '' && !ENTITY_PATTERNS[kind].test(value)) {
        throw new Error(`Invalid Home Assistant ${kind} entity`);
      }
    }
    if (!lockEntity) throw new Error('Home Assistant lock entity is required');
    this.base = base;
    this.token = token;
    this.cameraEntity = cameraEntity || null;
    this.lockEntity = lockEntity;
    this.ringEntity = ringEntity || null;
    this.previewEntity = previewEntity || null;
    this.deviceId = this.cameraEntity || this.lockEntity;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.WebSocket = WebSocketImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.reconnectDelayMs = reconnectDelayMs;
    this.stopped = true;
    this.socket = null;
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.attempt = 0;
    this.ringState = null;
    this.lastRingTimestamp = null;
    this.seenEvents = new Set();
    this.controllers = new Set();
  }

  async request(path, { method = 'GET', body, responseType = 'none' } = {}) {
    const target = new URL(path, this.base);
    if (target.origin !== this.base.origin || !target.pathname.startsWith('/api/') || target.username || target.password) {
      throw new Error('Home Assistant request must remain within its API origin');
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetch(target.toString(), {
        method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`Home Assistant HTTP ${response.status}`);
      // Keep the deadline and shutdown cancellation active through body reads.
      if (responseType === 'json') {
        try { return await response.json(); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          throw new Error('Home Assistant returned an invalid API response');
        }
      }
      if (responseType === 'buffer') return Buffer.from(await response.arrayBuffer());
      // Service responses still need draining: receiving headers is not completion.
      if (typeof response.arrayBuffer === 'function') await response.arrayBuffer();
      return response;
    } catch (error) {
      // Neither response bodies nor native fetch errors are safe to log: they
      // may contain credentials, URLs, or details of the household.
      if (/^Home Assistant HTTP \d+$/.test(error.message) ||
          error.message === 'Home Assistant returned an invalid API response') throw error;
      throw new Error('Home Assistant request failed or timed out');
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  async getPairings() {
    const lock = await this.request(`/api/states/${this.lockEntity}`, { responseType: 'json' });
    if (lock?.entity_id !== this.lockEntity) throw new Error('Home Assistant returned an unexpected lock entity');
    if (this.cameraEntity) {
      const camera = await this.request(`/api/states/${this.cameraEntity}`, { responseType: 'json' });
      if (camera?.entity_id !== this.cameraEntity) throw new Error('Home Assistant returned an unexpected camera entity');
    }
    if (this.previewEntity) {
      const preview = await this.request(`/api/states/${this.previewEntity}`, { responseType: 'json' });
      if (preview?.entity_id !== this.previewEntity) throw new Error('Home Assistant returned an unexpected preview entity');
    }
    return [{ deviceId: this.deviceId, tag: lock.attributes?.friendly_name || 'Fermax Door',
      accessDoorMap: { ZERO: { accessId: { entityId: this.lockEntity } } } }];
  }

  async openDoor(deviceId, accessDoor) {
    if (deviceId !== this.deviceId || accessDoor?.entityId !== this.lockEntity) {
      throw new Error('Home Assistant unlock target does not match the selected lock');
    }
    await this.request('/api/services/lock/unlock', { method: 'POST', body: { entity_id: this.lockEntity } });
    return true;
  }

  async getLastPicture(deviceId) {
    if (deviceId !== this.deviceId) throw new Error('Home Assistant camera target does not match');
    if (!this.cameraEntity) return null;
    return this.request(`/api/camera_proxy/${this.cameraEntity}`, { responseType: 'buffer' });
  }

  async getVideoSource() {
    if (!this.cameraEntity) throw new Error('Home Assistant camera entity is required for live video');
    if (this.previewEntity) {
      // A selected preview button wakes the upstream receive-only stream.
      // Ambiguous physical commands are never automatically replayed.
      await this.request('/api/services/button/press', {
        method: 'POST', body: { entity_id: this.previewEntity },
      });
    }
    return { url: new URL(`/api/camera_proxy_stream/${this.cameraEntity}`, this.base).toString(),
      inputArgs: ['-headers', `Authorization: Bearer ${this.token}\r\n`], forceTranscode: true };
  }

  async start(onRing) {
    if (!this.ringEntity) return;
    if (typeof this.WebSocket !== 'function') throw new Error('Home Assistant requires native WebSocket support');
    if (!this.stopped) return;
    this.stopped = false;
    this.seenEvents.clear();
    this.onRing = onRing;
    try {
      await this.connect();
    } catch (error) {
      this.scheduleReconnect();
      throw error;
    }
  }

  async connect() {
    const connectionStartedAt = Date.now();
    const state = await this.request(`/api/states/${this.ringEntity}`, { responseType: 'json' });
    if (state?.entity_id !== this.ringEntity) throw new Error('Home Assistant returned an unexpected ring entity');
    this.ringState = state.state;
    const initialTimestamp = Date.parse(state.state);
    if (Number.isFinite(initialTimestamp)) {
      this.lastRingTimestamp = Math.max(this.lastRingTimestamp ?? -Infinity, initialTimestamp);
    }
    if (this.stopped) return;
    const url = new URL('/api/websocket', this.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    await new Promise((resolve, reject) => {
      let settled = false;
      let subscribed = false;
      const pendingEvents = [];
      const socket = new this.WebSocket(url.toString());
      this.socket = socket;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
        if (error) reject(error); else resolve();
      };
      const fail = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        finish(new Error('Home Assistant event connection unavailable'));
        try { socket.close(); } catch { /* already closed */ }
        if (!this.stopped) {
          this.logger?.warn?.('Home Assistant events disconnected; reconnecting');
          this.scheduleReconnect();
        }
      };
      this.connectionTimer = setTimeout(fail, this.requestTimeoutMs);
      socket.addEventListener('error', fail);
      socket.addEventListener('close', fail);
      socket.addEventListener('message', (event) => {
        if (this.stopped || this.socket !== socket) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'auth_required') {
          socket.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        } else if (message.type === 'auth_ok') {
          socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));
        } else if (message.type === 'auth_invalid') {
          fail();
        } else if (message.type === 'result' && message.id === 1) {
          if (!message.success) return fail();
          this.attempt = 0;
          this.logger?.info?.('Home Assistant doorbell events connected');
          subscribed = true;
          finish();
          for (const pending of pendingEvents.splice(0)) handleEvent(pending);
        } else if (message.type === 'event' && message.id === 1) {
          if (subscribed) handleEvent(message);
          else if (pendingEvents.length < 1000) pendingEvents.push(message);
        }
      });
      const handleEvent = (message) => {
          if (this.stopped || this.socket !== socket) return;
          const data = message.event?.data;
          if (data?.entity_id !== this.ringEntity || !data.new_state) return;
          const eventId = message.event?.context?.id;
          if (eventId) {
            if (this.seenEvents.has(eventId)) return;
            this.seenEvents.add(eventId);
            if (this.seenEvents.size > 1000) this.seenEvents.delete(this.seenEvents.values().next().value);
          }
          const previous = this.ringState;
          this.ringState = data.new_state.state;
          let isRing = false;
          if (this.ringEntity.startsWith('event.')) {
            const timestamp = Date.parse(this.ringState);
            const isNew = Number.isFinite(timestamp) && timestamp > (this.lastRingTimestamp ?? -Infinity);
            if (Number.isFinite(timestamp)) {
              this.lastRingTimestamp = Math.max(this.lastRingTimestamp ?? -Infinity, timestamp);
            }
            // A new timestamp after this connection began can be the first
            // ring after an unknown baseline. Older restored values never ring.
            isRing = isNew && timestamp >= connectionStartedAt &&
              data.new_state.attributes?.event_type === 'ring';
          } else {
            isRing = previous === 'off' && this.ringState === 'on' && data.old_state?.state === 'off';
          }
          // Binary sensors require a known off -> on edge; timestamp event
          // entities require a fresh ring timestamp after connection startup.
          if (isRing) {
            try {
              Promise.resolve(this.onRing?.({ entityId: this.ringEntity }))
                .catch(() => this.logger?.warn?.('Home Assistant ring callback failed'));
            }
            catch { this.logger?.warn?.('Home Assistant ring callback failed'); }
          }
      };
      this.cancelConnection = () => finish(new Error('Home Assistant event connection stopped'));
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(this.reconnectDelayMs * 2 ** this.attempt++, 60000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try { await this.connect(); }
      catch { this.scheduleReconnect(); }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.cancelConnection?.();
    for (const controller of this.controllers) controller.abort();
    const socket = this.socket;
    this.socket = null;
    if (socket) { try { socket.close(); } catch { /* already closed */ } }
    this.onRing = null;
  }
}

module.exports = HomeAssistantClient;
