
import Service from './service.js';
import { log } from '../utils.js';

export default class TMPService extends Service {
  constructor(server) {
    super(server);
    this.tmpStorage = {};
    this.tmpStorageTimeouts = new Map();
  }

  request(pathname, req, res) {
    const file = pathname.replace(/^\/_tmp\//, '');

    if (req.method === 'GET') {
      return this.handleGet(file, res);
    }
    if (req.method === 'PUT') {
      return this.handlePut(file, req, res);
    }
  }

  handleGet(file, res) {
    const data = this.tmpStorage[file];
    if (data) {
      res.writeHead(200);
      res.end(data, 'binary');
    } else {
      res.writeHead(404);
      res.end('file not found');
    }
  }

  handlePut(file, req, res) {
    let fullBody = '';
    req.setEncoding('binary');

    req.on('data', chunk => {
      fullBody += chunk.toString();
    });

    req.on('end', () => {
      this.tmpStorage[file] = fullBody;

      // Clear existing timeout if present
      if (this.tmpStorageTimeouts.has(file)) {
        clearTimeout(this.tmpStorageTimeouts.get(file));
      }

      // Set new timeout and store it
      const timeout = setTimeout(() => {
        log('cleanup ' + file);
        delete this.tmpStorage[file];
        this.tmpStorageTimeouts.delete(file);
      }, this.server.options['tmp-cleanup-timeout'] || 5 * 60 * 1000);

      this.tmpStorageTimeouts.set(file, timeout);

      res.writeHead(200);
      res.end();
    });
  }

  cleanup() {
    // Clear all timeouts
    for (let timeout of this.tmpStorageTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.tmpStorageTimeouts.clear();
    this.tmpStorage = {};
  }
}
