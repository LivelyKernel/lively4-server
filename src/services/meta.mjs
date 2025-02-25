import Service from './service.mjs';

export default class METAService extends Service {

  request(pathname, req, res) {
    if (pathname.match(/_meta\/exit/)) {
      res.end('goodbye, we hope for the best!');
      process.exit();
    } else {
      res.writeHead(500);
      res.end('meta: ' + pathname + ' not implemented!');
    }
  }
}
