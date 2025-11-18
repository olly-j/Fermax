const fs = require('fs/promises');
const path = require('path');

class FileStore {
  constructor(baseDir, filename) {
    this.filePath = path.join(baseDir, filename);
  }

  async read(defaultValue = null) {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return defaultValue;
      }
      throw error;
    }
  }

  async write(payload) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
  }
}

module.exports = FileStore;

