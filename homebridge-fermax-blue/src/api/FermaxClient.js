const FileStore = require('../storage/FileStore');

const BASE_URL = 'https://blue.fermax.io';
const OAUTH_URL = 'https://oauth-blue.fermax.io/oauth/token';

const DEFAULT_CLIENT_ID = 'dpv7iqz6ee5mazm1iq9dw1d42slyut48kj0mp5fvo58j5ih';
const DEFAULT_CLIENT_SECRET = 'c7ylkqpujwah85yhnprv0wdvyzutlcnkw4sz90buldbulk1';

const COMMON_HEADERS = {
  'app-version': '3.3.2',
  'accept-language': 'en-ES;q=1.0, es-ES;q=0.9',
  'phone-os': '17.0',
  'user-agent':
    'Blue/3.3.2 (com.fermax.bluefermax; build:3; iOS 17.0.0) Alamofire/5.6.4',
  'phone-model': 'iPhone15,4',
  'app-build': '3',
};

class FermaxClient {
  constructor({
    username,
    password,
    logger,
    dataDir,
    clientId = DEFAULT_CLIENT_ID,
    clientSecret = DEFAULT_CLIENT_SECRET,
  }) {
    this.username = username;
    this.password = password;
    this.logger = logger;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenStore = new FileStore(dataDir, 'fermax-token.json');
    this.token = null;
    this.tokenPromise = null;
  }

  async ensureToken(force = false) {
    if (!force) {
      if (this.token && !this._isExpired(this.token.expiresAt)) {
        return this.token;
      }
      if (!this.token) {
        const cached = await this.tokenStore.read();
        if (cached) {
          cached.expiresAt = new Date(cached.expiresAt);
          this.token = cached;
          if (!this._isExpired(cached.expiresAt)) {
            return this.token;
          }
        }
      }
    }

    if (!force && this.token?.refreshToken) {
      try {
        await this.refreshToken();
        return this.token;
      } catch (error) {
        this.logger?.warn?.('Fermax: refresh token failed, performing reauth', error);
      }
    }

    if (!this.tokenPromise) {
      this.tokenPromise = this._authenticate();
    }
    const fresh = await this.tokenPromise;
    this.tokenPromise = null;
    return fresh;
  }

  async _authenticate() {
    const payload = new URLSearchParams();
    payload.set('grant_type', 'password');
    payload.set('username', this.username);
    payload.set('password', this.password);

    const response = await this._fetchWithRetry(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...COMMON_HEADERS,
      },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Fermax auth failed: ${response.status}`);
    }

    const json = await response.json();
    this.token = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: this._resolveExpiry(json),
    };
    await this.tokenStore.write({
      ...this.token,
      expiresAt: this.token.expiresAt.toISOString(),
    });
    return this.token;
  }

  async refreshToken() {
    const payload = new URLSearchParams();
    payload.set('grant_type', 'refresh_token');
    payload.set('refresh_token', this.token.refreshToken);

    const response = await this._fetchWithRetry(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...COMMON_HEADERS,
      },
      body: payload,
    });

    if (!response.ok) {
      throw new Error('Fermax refresh failed');
    }

    const json = await response.json();
    this.token = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? this.token.refreshToken,
      expiresAt: this._resolveExpiry(json),
    };
    await this.tokenStore.write({
      ...this.token,
      expiresAt: this.token.expiresAt.toISOString(),
    });
  }

  async request(endpoint, { method = 'GET', body, headers = {}, searchParams } = {}) {
    await this.ensureToken();

    const url = new URL(endpoint, BASE_URL);
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value);
        }
      });
    }

    const response = await this._fetchWithRetry(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token.accessToken}`,
        'Content-Type': body instanceof Buffer ? 'application/octet-stream' : 'application/json',
        ...COMMON_HEADERS,
        ...headers,
      },
      body: body && !(body instanceof Buffer) ? JSON.stringify(body) : body,
    });

    if (response.status === 401) {
      await this.ensureToken(true);
      return this.request(endpoint, { method, body, headers, searchParams });
    }

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Fermax request failed (${response.status}): ${message}`);
    }
    return response;
  }

  async _fetchWithRetry(url, options, retries = 3) {
    // Simple exponential backoff
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    
    for (let i = 0; i < retries; i++) {
      try {
        // Using default global fetch
        return await fetch(url, options);
      } catch (error) {
        const isNetworkError = error.cause?.code === 'ETIMEDOUT' || 
                               error.cause?.code === 'ECONNREFUSED' ||
                               error.message.includes('fetch failed');
                               
        if (isNetworkError && i < retries - 1) {
          const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
          this.logger?.debug?.(`Fermax network error, retrying in ${delay}ms...`, error.message);
          await wait(delay);
          continue;
        }
        throw error;
      }
    }
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
    return response.status === 200;
  }

  async registerAppToken(appToken, active = true) {
    await this.request('/notification/api/v1/apptoken', {
      method: 'POST',
      body: {
        token: appToken,
        active,
        os: 'Android',
        osVersion: '13',
        locale: 'en',
        appVersion: '3.3.2',
      },
    });
  }

  async acknowledgeNotification(fcmMessageId) {
    if (!fcmMessageId) {
      return;
    }
    await this.request('/callmanager/api/v1/message/ack', {
      method: 'POST',
      body: {
        attended: true,
        fcmMessageId,
      },
    });
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
    if (json.expires_on) {
      return new Date(json.expires_on);
    }
    const expiresIn = json.expires_in ?? 3600;
    return new Date(Date.now() + expiresIn * 1000);
  }

  _isExpired(expiresAt) {
    return Date.now() >= new Date(expiresAt).getTime() - 60 * 1000;
  }
}

module.exports = FermaxClient;

