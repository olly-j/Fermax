const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const FermaxClient = require('../src/api/FermaxClient');
const FileStore = require('../src/storage/FileStore');

const auth = (overrides = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, ...overrides }),
});
const response = (status) => ({ ok: status >= 200 && status < 300, status, text: jest.fn(async () => 'secret response body') });

describe('Fermax client security and reliability', () => {
  let directory;
  let client;
  let previousFetch;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fermax-hardening-'));
    previousFetch = global.fetch;
    global.fetch = jest.fn();
    client = new FermaxClient({ username: 'first', password: 'secret', dataDir: directory, logger: { warn: jest.fn() } });
  });
  afterEach(async () => {
    await client.stop();
    global.fetch = previousFetch;
    jest.useRealTimers();
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('clears a rejected authentication promise so a later login can recover', async () => {
    fetch.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(auth());
    await expect(client.ensureToken()).rejects.toThrow('network');
    expect(client.tokenPromise).toBeNull();
    await expect(client.ensureToken()).resolves.toMatchObject({ accessToken: 'access' });
  });

  test('serializes concurrent password authentication and token refresh', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce(auth({ access_token: 'renewed' }));
    await Promise.all(Array.from({ length: 8 }, () => client.ensureToken()));
    expect(fetch).toHaveBeenCalledTimes(1);
    client.token.expiresAt = new Date(0);
    const tokens = await Promise.all(Array.from({ length: 8 }, () => client.ensureToken()));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(tokens.every((token) => token.accessToken === 'renewed')).toBe(true);
    expect(fetch.mock.calls[1][1].body.get('grant_type')).toBe('refresh_token');
  });

  test('concurrent explicit refresh calls share one refresh exchange', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce(auth());
    await client.ensureToken();
    await Promise.all([client.refreshToken(), client.refreshToken(), client.ensureToken()]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('repeated 401 responses cause only one reauthentication', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(auth({ access_token: 'new' })).mockResolvedValueOnce(response(401));
    await expect(client.openDoor('door', { block: 0, number: 0, subblock: 0 })).rejects.toThrow('(401)');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  test.each([500, 502, 503])('does not replay a door command after HTTP %s', async (status) => {
    const failed = response(status);
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce(failed);
    await expect(client.openDoor('door', { block: 0, number: 0, subblock: 0 })).rejects.toThrow(`(${status})`);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(failed.text).not.toHaveBeenCalled();
  });

  test('does not replay a door command after an uncertain network failure or expose its details', async () => {
    fetch.mockResolvedValueOnce(auth()).mockRejectedValueOnce(new Error('fetch failed password=secret'));
    await expect(client.openDoor('door', {})).rejects.toThrow('Fermax request failed: network error or timeout');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(client.logger.warn).not.toHaveBeenCalled();
  });

  test('read requests retain bounded retry and sanitize logs', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce(response(500))
      .mockRejectedValueOnce(new Error('fetch token=secret')).mockResolvedValueOnce(response(200));
    client._retryDelay = jest.fn();
    await expect(client.request('/pairing/api/v3/pairings/me')).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(client._retryDelay).toHaveBeenCalledTimes(2);
  });

  test('authentication is bounded even when fetch ignores abort', async () => {
    jest.useFakeTimers();
    fetch.mockImplementation(() => new Promise(() => {}));
    const pending = expect(client.ensureToken(true)).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(15000);
    await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(client.tokenPromise).toBeNull();
  });

  test('token response body parsing is bounded too', async () => {
    jest.useFakeTimers();
    fetch.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const pending = expect(client.ensureToken(true)).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(15000);
    await pending;
  });

  test('door request timeout aborts and does not replay', async () => {
    fetch.mockResolvedValueOnce(auth());
    await client.ensureToken();
    jest.useFakeTimers();
    fetch.mockImplementation(() => new Promise(() => {}));
    const pending = expect(client.openDoor('door', {})).rejects.toThrow('network error or timeout');
    await jest.advanceTimersByTimeAsync(15000);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });

  test('API response JSON reads have a deadline and sanitized parsing errors', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce({
      ok: true, status: 200, json: () => new Promise(() => {}),
    });
    await client.ensureToken();
    jest.useFakeTimers();
    const pending = expect(client.getPairings()).rejects.toThrow('body failed or timed out');
    await jest.advanceTimersByTimeAsync(15000);
    await pending;
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });

  test('JSON parse errors do not expose fragments of confidential response bodies', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => { throw new Error('invalid JSON near secret-token'); },
    });
    await expect(client.getPairings()).rejects.toThrow('Fermax response body failed or timed out');
  });

  test.each([
    { access_token: undefined }, { access_token: '' }, { refresh_token: 123 },
    { expires_in: -1 }, { expires_in: 'wrong' }, { expires_in: undefined },
    { expires_on: 'invalid' }, { expires_on: null },
  ])('rejects invalid token data: %j', async (fields) => {
    fetch.mockResolvedValueOnce(auth(fields));
    await expect(client.ensureToken(true)).rejects.toThrow('invalid token');
    expect(client.token).toBeNull();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  test('accepts Unix expiry seconds and rejects malformed cached credentials', async () => {
    await client.tokenStore.write({ accessToken: 'bad', expiresAt: 'invalid' });
    const expires = Math.floor(Date.now() / 1000) + 3600;
    fetch.mockResolvedValueOnce(auth({ expires_on: expires }));
    const token = await client.ensureToken();
    expect(token.expiresAt.getTime()).toBe(expires * 1000);
  });

  test('tokens are scoped to account and OAuth client; legacy shared token is ignored', async () => {
    await fs.writeFile(path.join(directory, 'fermax-token.json'), JSON.stringify({ accessToken: 'legacy', expiresAt: '2099-01-01' }));
    fetch.mockResolvedValue(auth());
    const other = new FermaxClient({ username: 'second', password: 'secret', dataDir: directory });
    const otherClient = new FermaxClient({ username: 'first', password: 'secret', dataDir: directory, clientId: 'other', clientSecret: 'other-secret' });
    await Promise.all([client.ensureToken(), other.ensureToken(), otherClient.ensureToken()]);
    expect(fetch).toHaveBeenCalledTimes(3);
    const filenames = await fs.readdir(directory);
    expect(filenames).toHaveLength(4);
    expect(filenames.join(' ')).not.toContain('first');
    expect(filenames.join(' ')).not.toContain('second');
    const again = new FermaxClient({ username: 'first', password: 'secret', dataDir: directory });
    await again.ensureToken();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('disables redirects for authentication and API calls', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce(response(200));
    await client.request('/pairing/api/v3/pairings/me');
    expect(fetch.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
  });

  test('defaults to current DuoxMe services and supports approved legacy endpoints', async () => {
    expect(client.baseUrl).toBe('https://pro-duoxme.fermax.io');
    expect(client.authUrl).toBe('https://oauth-pro-duoxme.fermax.io/oauth/token');
    const legacy = new FermaxClient({
      username: 'first', password: 'secret', dataDir: directory,
      baseUrl: 'https://blue.fermax.io', authUrl: 'https://oauth-blue.fermax.io/oauth/token',
    });
    expect(legacy.tokenStore.filePath).not.toBe(client.tokenStore.filePath);
    fetch.mockResolvedValueOnce(auth());
    await legacy.ensureToken();
    expect(fetch.mock.calls[0][0]).toBe('https://oauth-blue.fermax.io/oauth/token');
  });

  test.each([
    { baseUrl: 'http://pro-duoxme.fermax.io' },
    { baseUrl: 'https://pro-duoxme.fermax.io.evil.example' },
    { baseUrl: 'https://pro-duoxme.fermax.io:8443' },
    { baseUrl: 'https://user:password@pro-duoxme.fermax.io' },
    { baseUrl: 'https://pro-duoxme.fermax.io/private' },
    { authUrl: 'https://example.com/oauth/token' },
    { authUrl: 'https://oauth-pro-duoxme.fermax.io/oauth/token?redirect=evil' },
  ])('rejects unapproved service URLs: %j', (urls) => {
    expect(() => new FermaxClient({ username: 'first', password: 'secret', dataDir: directory, ...urls })).toThrow('approved HTTPS');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('registers push tokens with the current Android app metadata', async () => {
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce(response(200));
    await client.registerAppToken('push-token');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      active: true, token: 'push-token', appVersion: '4.3.0', locale: 'en_US',
      os: 'Android', osVersion: '14.0', appBuild: '721', phoneMobile: 'Homebridge',
    });
  });

  test.each(['network', 'token body'])('stop promptly cancels stalled OAuth %s and prevents late cache writes', async (phase) => {
    jest.useFakeTimers();
    let finish;
    const stalled = new Promise((resolve) => { finish = resolve; });
    fetch.mockImplementation(() => phase === 'network' ? stalled : Promise.resolve({
      ok: true, json: () => stalled,
    }));
    const write = jest.spyOn(client.tokenStore, 'write');
    const pending = expect(client.ensureToken(true)).rejects.toThrow('client stopped');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.stop();
    await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    finish(phase === 'network' ? auth() : { access_token: 'late', expires_in: 3600 });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    expect(client.token).toBeNull();
    await expect(client.ensureToken()).rejects.toThrow('client stopped');
    await expect(client.refreshToken()).rejects.toThrow('client stopped');
    await expect(client.openDoor('door', {})).rejects.toThrow('client stopped');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(['network', 'JSON body'])('stop promptly cancels stalled API %s without a retry', async (phase) => {
    fetch.mockResolvedValueOnce(auth());
    await client.ensureToken();
    jest.useFakeTimers();
    fetch.mockImplementation(() => phase === 'network' ? new Promise(() => {}) : Promise.resolve({
      ok: true, status: 200, json: () => new Promise(() => {}),
    }));
    const pending = expect(client.getPairings()).rejects.toThrow('client stopped');
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    await client.stop();
    await pending;
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    expect(client.controllers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('stop settles retry backoff and prevents another read request', async () => {
    fetch.mockResolvedValueOnce(auth());
    await client.ensureToken();
    jest.useFakeTimers();
    fetch.mockRejectedValue(new Error('offline'));
    const pending = expect(client.getPairings()).rejects.toThrow('client stopped');
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(client.retryWaits.size).toBe(1);
    await client.stop();
    await pending;
    await jest.advanceTimersByTimeAsync(60000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(client.retryWaits.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('stop during cache loading prevents authentication', async () => {
    let finish;
    jest.spyOn(client.tokenStore, 'read').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = expect(client.ensureToken()).rejects.toThrow('client stopped');
    await client.stop();
    finish(null);
    await pending;
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(['unlock', 'registration'])('successful %s cancels unused HTTP body once without replay', async (command) => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    fetch.mockResolvedValueOnce(auth()).mockResolvedValueOnce({ ok: true, status: 200, body: { cancel } });
    if (command === 'unlock') await expect(client.openDoor('door', {})).resolves.toBe(true);
    else await client.registerAppToken('push-token');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(client.controllers.size).toBe(0);
  });

  test('rejects foreign endpoints before sending bearer tokens', async () => {
    fetch.mockResolvedValueOnce(auth());
    await expect(client.request('https://example.com/private')).rejects.toThrow('API origin');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('atomically replaces loose-permission files with private complete JSON', async () => {
    const store = new FileStore(directory, 'state.json');
    await fs.writeFile(store.filePath, '{}', { mode: 0o644 });
    await store.write({ secret: 'token' });
    expect((await fs.stat(store.filePath)).mode & 0o777).toBe(0o600);
    expect(await store.read()).toEqual({ secret: 'token' });
    expect(await fs.readdir(directory)).toEqual(['state.json']);
  });

  test('corrupt JSON cache recovers and failed writes clean up their temporary files', async () => {
    const store = new FileStore(directory, 'state.json');
    await fs.writeFile(store.filePath, '{');
    expect(await store.read({ fallback: true })).toEqual({ fallback: true });
    const circular = {}; circular.self = circular;
    await expect(store.write(circular)).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual(['state.json']);
    expect(await fs.readFile(store.filePath, 'utf8')).toBe('{');
  });

  test('does not follow a cache symlink', async () => {
    const store = new FileStore(directory, 'state.json');
    const target = path.join(directory, 'target.json');
    await fs.writeFile(target, '{}');
    await fs.symlink(target, store.filePath);
    await expect(store.read()).rejects.toMatchObject({ code: 'ELOOP' });
    await store.write({ safe: true });
    expect(await fs.readFile(target, 'utf8')).toBe('{}');
    expect(await store.read()).toEqual({ safe: true });
  });
});
