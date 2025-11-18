const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const FermaxClient = require('../src/api/FermaxClient');

describe('FermaxClient', () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fermax-client-'));
    global.fetch = jest.fn();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    jest.resetAllMocks();
  });

  function mockAuthResponse() {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'token-123',
        refresh_token: 'refresh-123',
        expires_in: 3600,
      }),
    });
  }

  test('performs OAuth password grant', async () => {
    mockAuthResponse();

    const client = new FermaxClient({
      username: 'user@example.com',
      password: 'secret',
      dataDir: tmpDir,
      logger: console,
    });

    const token = await client.ensureToken(true);
    expect(token.accessToken).toBe('token-123');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('oauth-blue.fermax.io/oauth/token'),
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  test('openDoor sends directed-opendoor request', async () => {
    mockAuthResponse();
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const client = new FermaxClient({
      username: 'user@example.com',
      password: 'secret',
      dataDir: tmpDir,
      logger: console,
    });

    const result = await client.openDoor('device-1', {
      block: 0,
      subblock: 0,
      number: 0,
    });

    expect(result).toBe(true);
    const lastCall = fetch.mock.calls.at(-1);
    expect(String(lastCall[0])).toContain(
      '/deviceaction/api/v1/device/device-1/directed-opendoor',
    );
    expect(lastCall[1].method).toBe('POST');
  });
});

