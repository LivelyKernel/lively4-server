import Service from "./service.mjs";
import URL from 'url';
import { exec } from 'child_process';

export default class CurlService extends Service {
  
  async request(pathname, req, res) {
    const target = URL.parse(req.url, true).query["target"];
    
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
