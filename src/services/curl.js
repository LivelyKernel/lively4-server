import Service from "./service.js";
import URL from 'url';
import { exec } from 'child_process';

export default class CurlService extends Service {

  async request(pathname, req, res) {
    const url = URL.parse(req.url, true);
    const target = url.query["target"];

    if (!target || target.length == 0) {
      res.writeHead(300);
      res.end('no url parameter provided ');
      return;
    }

    let curlArgs = `-L "${target}"`;
    
    // Use the incoming request method
    if (req.method && req.method !== "GET") {
      curlArgs += ` -X ${req.method}`;
    }
    
    // Forward headers (skip some internal headers)
    const skipHeaders = ['host', 'connection', 'content-length'];
    for (let [key, value] of Object.entries(req.headers)) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        curlArgs += ` -H "${key}: ${value.replace(/"/g, '\\"')}"`;
      }
    }

    // If there's a body, read and forward it
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      const body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
      
      if (body) {
        // Escape single quotes for shell
        const escapedBody = body.replace(/'/g, "'\\''");
        curlArgs += ` -d '${escapedBody}'`;
      }
    }

    exec(`curl ${curlArgs}`, {
      encoding: 'binary',
      maxBuffer: 1024 * 1000 * 100
    }, (error, stdout, stderr) => {
      if (error) {
        res.writeHead(500);
        res.end(`curl error: ${stderr || error.message}`);
        return;
      }
      res.writeHead(200);
      res.end(stdout, "binary");
    });
  }
}
