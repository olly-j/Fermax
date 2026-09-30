jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

const { spawnSync } = require('node:child_process');
const { probeFfmpeg } = require('../verify-install');

describe('installed FFmpeg availability', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('checks executable startup, not dependency resolution alone', () => {
    spawnSync.mockReturnValue({ status: 0 });
    expect(probeFfmpeg('/test/ffmpeg')).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith('/test/ffmpeg', ['-version'], expect.objectContaining({ timeout: 5000 }));
    expect(console.warn).not.toHaveBeenCalled();
  });

  test.each([
    { error: Object.assign(new Error('missing'), { code: 'ENOENT' }), status: null },
    { error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), status: null },
    { status: 1 },
  ])('warns when video cannot run while allowing door-only operation: %j', result => {
    spawnSync.mockReturnValue(result);
    expect(probeFfmpeg('/test/ffmpeg')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Door release and alerts can run'));
  });
});
