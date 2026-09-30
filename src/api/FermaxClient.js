const FileStore = require('../storage/FileStore');
const { createHash } = require('crypto');

const BASE_URL = 'https://pro-duoxme.fermax.io';
const OAUTH_URL = 'https://oauth-pro-duoxme.fermax.io/oauth/token';

// Legacy mobile-app credentials retained for compatibility; current accounts may
// require explicitly configured OAuth credentials. Their validity is unverified.
const DEFAULT_CLIENT_ID = 'dpv7iqz6ee5mazm1iq9dw1d42slyut48kj0mp5fvo58j5ih';
const DEFAULT_CLIENT_SECRET = 'c7ylkqpujwah85yhnprv0wdvyzutlcnkw4sz90buldbulk1';

const COMMON_HEADERS = {
  'app-version': '4.3.0',
  'accept-language': 'en-ES;q=1.0, es-ES;q=0.9',
  'phone-os': '14.0',
  'user-agent':
    'FermaxBlue/4.3.0 (Android 14.0; Homebridge)',
  'phone-model': 'Homebridge',
  'app-build': '721',
};

class FermaxClient {
  constructor({
    username,
    password,
    logger,
    dataDir,
    clientId = DEFAULT_CLIENT_ID,
    clientSecret = DEFAULT_CLIENT_SECRET,
    requestTimeoutMs = 15000,
    baseUrl = BASE_URL,
    authUrl = OAUTH_URL,
  }) {
    this.username = username;
    this.password = password;
    this.logger = logger;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error('Fermax request timeout must be positive');
    }
    this.requestTimeoutMs = requestTimeoutMs;
    this.baseUrl = this._validateServiceUrl(baseUrl, ['blue.fermax.io', 'pro-duoxme.fermax.io'], false);
    this.authUrl = this._validateServiceUrl(authUrl, ['oauth-blue.fermax.io', 'oauth-pro-duoxme.fermax.io'], true);
    const account = createHash('sha256').update(JSON.stringify([username, clientId, this.baseUrl, this.authUrl])).digest('hex');
    this.tokenStore = new FileStore(dataDir, `fermax-token-${account}.json`);
    this.token = null;
    this.tokenPromise = null;
    this.stopped = false;
    this.controllers = new Set();
    this.retryWaits = new Set();
    this.cacheWrites = new Set();
  }

  async ensureToken(force = false) {
    this._assertRunning();
    if (this.tokenPromise) return this.tokenPromise;
    if (!force && this._isValidToken(this.token) && !this._isExpired(this.token.expiresAt)) {
      return this.token;
    }
    const pending = this._ensureToken(force);
    this.tokenPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.tokenPromise === pending) this.tokenPromise = null;
    }
  }

  async _ensureToken(force) {
    if (!force && !this.token) {
      const cached = await this.tokenStore.read();
      this._assertRunning();
      if (this._isValidToken(cached)) {
        this.token = { ...cached, expiresAt: new Date(cached.expiresAt) };
        if (!this._isExpired(this.token.expiresAt)) return this.token;
      }
    }
    if (!force && this.token?.refreshToken) {
      try {
        return await this._refreshToken();
      } catch {
        this._assertRunning();
        this.logger?.warn?.('Fermax: refresh token failed, performing reauth');
      }
    }
    return this._authenticate();
  }

  async _authenticate() {
    return this._exchangeToken({
      grant_type: 'password', username: this.username, password: this.password,
    });
  }

  async refreshToken() {
    this._assertRunning();
    if (this.tokenPromise) return this.tokenPromise;
    const pending = this._refreshToken();
    this.tokenPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.tokenPromise === pending) this.tokenPromise = null;
    }
  }

  async _refreshToken() {
    if (!this.token?.refreshToken) throw new Error('Fermax refresh token unavailable');
    return this._exchangeToken({
      grant_type: 'refresh_token', refresh_token: this.token.refreshToken,
    }, this.token.refreshToken);
  }

  async _exchangeToken(fields, previousRefreshToken) {
    this._assertRunning();
    const json = await this._fetch(this.authUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...COMMON_HEADERS,
      },
      body: new URLSearchParams(fields),
    }, true);
    this._assertRunning();
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('Fermax returned an invalid token');
    }
    const token = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? previousRefreshToken,
      expiresAt: this._resolveExpiry(json),
    };
    if (!this._isValidToken(token) || token.expiresAt.getTime() <= Date.now()) {
      throw new Error('Fermax returned an invalid token');
    }
    this._assertRunning();
    const write = this.tokenStore.write({ ...token, expiresAt: token.expiresAt.toISOString() });
    this.cacheWrites.add(write);
    try { await write; }
    finally { this.cacheWrites.delete(write); }
    this._assertRunning();
    this.token = token;
    return token;
  }

  _assertRunning() {
    if (this.stopped) throw new Error('Fermax client stopped');
  }

  async _boundedOperation(operation, controller, timeoutMessage) {
    this._assertRunning();
    let timer;
    let onAbort;
    try {
      return await Promise.race([
        new Promise((_, reject) => {
          onAbort = () => reject(new Error(this.stopped ? 'Fermax client stopped' : timeoutMessage));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
          if (controller.signal.aborted) onAbort();
        }),
        Promise.resolve().then(() => {
          this._assertRunning();
          if (controller.signal.aborted) throw new Error(timeoutMessage);
          return operation();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
    }
  }

  async _fetch(url, options, parseToken = false) {
    this._assertRunning();
    const controller = new AbortController();
    this.controllers.add(controller);
    let responseReturned = false;
    try {
      const result = await this._boundedOperation(async () => {
        // Never forward OAuth passwords or bearer tokens through a redirect.
        const response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
        this._assertRunning();
        if (!parseToken) return this._boundedResponse(response, controller);
        if (!response.ok) throw new Error(`Fermax auth failed (${response.status})`);
        try { return await response.json(); }
        catch { throw new Error('Fermax returned an invalid token response'); }
      }, controller, 'Fermax request timed out');
      responseReturned = !parseToken;
      return result;
    } finally {
      if (!responseReturned) this.controllers.delete(controller);
    }
  }

  _boundedResponse(response, controller) {
    const bodyMethods = new Set(['json', 'text', 'arrayBuffer', 'blob', 'formData']);
    const read = async (operation) => {
      try {
        return await this._boundedOperation(operation, controller, 'Fermax response timed out');
      } catch {
        this._assertRunning();
        throw new Error('Fermax response body failed or timed out');
      } finally {
        this.controllers.delete(controller);
      }
    };
    return new Proxy(response, {
      get: (target, property) => {
        const value = Reflect.get(target, property, target);
        if (property === 'body' && value) {
          return new Proxy(value, {
            get: (body, key) => {
              const member = Reflect.get(body, key, body);
              if (key === 'cancel') return (...args) => read(() => member.apply(body, args));
              return typeof member === 'function' ? member.bind(body) : member;
            },
          });
        }
        if (typeof value !== 'function') return value;
        if (!bodyMethods.has(property)) return value.bind(target);
        return (...args) => read(() => value.apply(target, args));
      },
    });
  }

  async _discardResponse(response) {
    // Commands use the acknowledged status only. Cancel unused service bodies
    // so a server cannot retain an unread response indefinitely.
    if (response.body?.cancel) await response.body.cancel();
    else if (typeof response.arrayBuffer === 'function') await response.arrayBuffer();
    else if (typeof response.text === 'function') await response.text();
    this._assertRunning();
  }

  async stop() {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    for (const cancel of this.retryWaits) cancel();
    this.retryWaits.clear();
    // Writes already started finish before stop returns; no new write can start.
    await Promise.allSettled([...this.cacheWrites]);
  }

  async request(endpoint, { method = 'GET', body, headers = {}, searchParams } = {}) {
    this._assertRunning();
    await this.ensureToken();
    this._assertRunning();
    const url = new URL(endpoint, this.baseUrl);
    if (url.origin !== this.baseUrl) throw new Error('Fermax endpoint must use the Fermax API origin');
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, value);
      });
    }
    const canRetry = ['GET', 'HEAD'].includes(method.toUpperCase());
    let failures = 0;
    let reauthenticated = false;
    while (true) {
      this._assertRunning();
      const usedToken = this.token;
      let response;
      try {
        response = await this._fetch(url, {
          method,
          headers: {
            ...COMMON_HEADERS,
            ...headers,
            Authorization: `Bearer ${usedToken.accessToken}`,
            'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
          },
          body: body != null && !Buffer.isBuffer(body) ? JSON.stringify(body) : body,
        });
      } catch {
        this._assertRunning();
        failures++;
        if (!canRetry || failures >= 3) {
          throw new Error('Fermax request failed: network error or timeout');
        }
        await this._retryDelay(failures);
        continue;
      }
      if (response.status === 401 && !reauthenticated) {
        reauthenticated = true;
        await response.body?.cancel?.();
        // Another request may already have replaced the rejected token.
        if (this.token === usedToken) await this.ensureToken(true);
        else await this.ensureToken();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel?.();
        failures++;
        if (canRetry && response.status >= 500 && failures < 3) {
          await this._retryDelay(failures);
          continue;
        }
        throw new Error(`Fermax request failed (${response.status})`);
      }
      return response;
    }
  }

  async _retryDelay(attempt) {
    const delay = 1000 * 2 ** (attempt - 1);
    this.logger?.warn?.(`Fermax request failed, retrying in ${delay}ms (attempt ${attempt}/3)`);
    this._assertRunning();
    await new Promise((resolve) => {
      let timer;
      const cancel = () => {
        clearTimeout(timer);
        this.retryWaits.delete(cancel);
        resolve();
      };
      timer = setTimeout(cancel, delay);
      this.retryWaits.add(cancel);
    });
    this._assertRunning();
  }

  _validateServiceUrl(value, hosts, isAuth) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Fermax service URL is invalid');
    }
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash
      || url.pathname !== (isAuth ? '/oauth/token' : '/')) {
      throw new Error('Fermax service URL must use an approved HTTPS Fermax endpoint');
    }
    return isAuth ? url.href : url.origin;
  }

  _isValidToken(token) {
    return Boolean(token && typeof token.accessToken === 'string' && token.accessToken.trim()
      && (token.refreshToken === undefined || (typeof token.refreshToken === 'string' && token.refreshToken.trim()))
      && Number.isFinite(new Date(token.expiresAt).getTime()));
  }

  async getPairings() {
    const response = await this.request('/pairing/api/v3/pairings/me');
    return response.json();
  }

  async getDeviceInfo(deviceId) {
    const response = await this.request(`/deviceaction/api/v1/device/${deviceId}`);
    return response.json();
  }

  async openDoor(deviceId, accessDoor) {
    const response = await this.request(
      `/deviceaction/api/v1/device/${deviceId}/directed-opendoor`,
      {
        method: 'POST',
        body: {
          block: accessDoor.block,
          number: accessDoor.number,
          subblock: accessDoor.subblock,
        },
      },
    );
    await this._discardResponse(response);
    return response.status === 200;
  }

  async registerAppToken(appToken, active = true) {
    const response = await this.request('/notification/api/v1/apptoken', {
      method: 'POST',
      body: {
        token: appToken,
        active,
        os: 'Android',
        osVersion: '14.0',
        locale: 'en_US',
        appVersion: '4.3.0',
        appBuild: '721',
        phoneMobile: 'Homebridge',
      },
    });
    await this._discardResponse(response);
  }

  async acknowledgeNotification(fcmMessageId) {
    if (!fcmMessageId) {
      return;
    }
    const response = await this.request('/callmanager/api/v1/message/ack', {
      method: 'POST',
      body: {
        attended: true,
        fcmMessageId,
      },
    });
    await this._discardResponse(response);
  }

  async getLastPicture(deviceId, appToken) {
    const response = await this.request('/callManager/api/v1/callregistry/participant', {
      searchParams: {
        appToken,
        callRegistryType: 'all',
      },
    });
    const entries = await response.json();
    const latest = entries
      .filter((entry) => entry.deviceId === deviceId && entry.photoId)
      .sort(
        (a, b) => new Date(b.callDate).getTime() - new Date(a.callDate).getTime(),
      )[0];

    if (!latest) {
      return null;
    }

    const photoResponse = await this.request('/callManager/api/v1/photocall', {
      searchParams: {
        photoId: latest.photoId,
      },
    });
    const payload = await photoResponse.json();
    if (!payload?.image?.data) {
      return null;
    }
    return Buffer.from(payload.image.data, 'base64');
  }

  _resolveExpiry(json) {
    if (json.expires_on !== undefined) {
      const value = json.expires_on;
      const numeric = typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value));
      const expiry = new Date(numeric ? Number(value) * 1000 : value);
      if (!Number.isFinite(expiry.getTime())) throw new Error('Fermax returned an invalid token expiry');
      return expiry;
    }
    const expiresIn = Number(json.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('Fermax returned an invalid token expiry');
    }
    return new Date(Date.now() + expiresIn * 1000);
  }

  _isExpired(expiresAt) {
    const expiry = new Date(expiresAt).getTime();
    return !Number.isFinite(expiry) || Date.now() >= expiry - 60 * 1000;
  }

}

module.exports = FermaxClient;

