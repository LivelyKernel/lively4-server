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

    exec(`curl -L "${target}"`, {
      encoding: 'binary',
      maxBuffer: 1024 * 1000 * 100
    }, (error, stdout, stderr) => {
      res.writeHead(200);
      res.end(stdout, "binary");
    });
  }
}
