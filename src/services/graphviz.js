
import Service from './service.js';
import { run, fs_writeFile, logRequest } from '../utils.js';
import { cleanString } from '../utils.js';

export default class GraphVizService extends Service {

  async request(pathname, req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405);
      return res.end('Method not allowed');
    }

    let fullBody = '';
    req.setEncoding('binary');

    await new Promise(resolve => {
      req.on('data', chunk => {
        fullBody += chunk.toString();
      });
      req.on('end', resolve);
    });

    const tempFile = (await run("mktemp --suffix=.dot")).stdout.replace(/\n/g, "");
    await fs_writeFile(tempFile, fullBody);

    const layout = req.headers['graphlayout'] ? cleanString(req.headers['graphlayout']) : "dot";
    const type = "svg";

    try {
      const result = await run(`${layout} -T${type} '${tempFile}'`);
      const source = result.stdout;

      if (source == "") {
        logRequest(req, "GraphViz ERR: " + result.stderr);
        res.writeHead(400);
        res.end(result.stderr);
      } else {
        res.writeHead(200);
        res.end(source);
      }
    } finally {
      await run(`rm '${tempFile}'`);
    }
  }
}
