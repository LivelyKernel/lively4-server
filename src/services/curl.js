import Service from "./service.js";
import URL from 'url';
import { execFile } from 'child_process';

export default class CurlService extends Service {

  async request(pathname, req, res) {
    const url = URL.parse(req.url, true);
    const target = url.query["target"];

    if (!target || target.length == 0) {
      res.writeHead(300);
      res.end('no url parameter provided ');
      return;
    }

    // Build an argv array and invoke curl via execFile (no shell). This avoids
    // shell quoting entirely, so it behaves identically under cmd.exe (Windows)
    // and bash (Linux) — the previous string+exec form used POSIX single-quote
    // escaping that cmd.exe does not honour.
    const args = ['-L', target];

    // Use the incoming request method
    if (req.method && req.method !== "GET") {
      args.push('-X', req.method);
    }

    // Forward headers (skip internal headers and headers that should only be set via x-header-)
    const skipHeaders = ['host', 'connection', 'content-length', 'origin', 'referer'];
    for (let [key, value] of Object.entries(req.headers)) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        args.push('-H', `${key}: ${value}`);
      }
    }

    // Inject custom headers from query parameters (prefixed with x-header-)
    // This allows spoofing headers like Origin, Referer that browsers restrict
    for (let [key, value] of Object.entries(url.query)) {
      if (key.startsWith('x-header-')) {
        const headerName = key.substring(9); // Remove 'x-header-' prefix
        args.push('-H', `${headerName}: ${value}`);
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
        args.push('-d', body);
      }
    }

    console.log('[CURL] Executing: curl', args.join(' ').substring(0, 500));

    execFile('curl', args, {
      encoding: 'binary',
      maxBuffer: 1024 * 1000 * 100
    }, (error, stdout, stderr) => {
      if (error) {
        console.log('[CURL] Error:', stderr || error.message);
        res.writeHead(500);
        res.end(`curl error: ${stderr || error.message}`);
        return;
      }
      console.log('[CURL] Success, output length:', stdout.length);
      res.writeHead(200);
      res.end(stdout, "binary");
    });
  }
}
