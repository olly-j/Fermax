const fs = require('fs/promises');
const { constants } = require('fs');
const { randomUUID } = require('crypto');
const path = require('path');

class FileStore {
  constructor(baseDir, filename) {
    this.filePath = path.join(baseDir, filename);
  }

  async read(defaultValue = null) {
    let handle;
    try {
      handle = await fs.open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      await handle.chmod(0o600);
      const raw = await handle.readFile('utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return defaultValue;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async write(payload) {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(payload, null, 2), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, this.filePath);
    } finally {
      await handle?.close();
      await fs.rm(temporary, { force: true });
    }
  }
}

module.exports = FileStore;
