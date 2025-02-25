import Service from './service.mjs';
import URL from 'url';
import { respondWithCMD } from '../utils.js';
export default class MakeService extends Service {

  async request(path, req, res) {
    const params = URL.parse(req.url, true).query;
    const dir = path.replace(/.*_make\//, "");
    return respondWithCMD(
      "cd " + this.server.lively4DirUnix + dir + "; make " + (params.target || ""),
      res
    );
  }
}
