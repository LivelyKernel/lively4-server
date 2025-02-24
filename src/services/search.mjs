import Service from "./service.mjs";
import { cleanString, run, respondWithCMD } from '../utils.js';

/**
 * SEARCH Service class implements file content search
 * @extends Service
 */
export default class SEARCH extends Service {

  /**
   * Handles SEARCH request to search for file content
   * @param {string} pathname - Request pathname
   * @param {http.IncomingMessage} req - HTTP request object
   * @param {http.ServerResponse} res - HTTP response object
   * @returns {Promise<void>} - Resolves when search is complete
   */
  async request(pathname, req, res) {
    const pattern = req.headers['searchpattern'];
    const rootdirs = req.headers['rootdirs'];
    const excludes = '.git,' + req.headers['excludes'];

    let cmd = 'cd ' + this.server.lively4DirUnix + '; ';
    cmd += 'find ' + rootdirs.replace(/,/g, ' ') + ' -type f ';
    cmd += excludes
      .split(',')
      .map(function (ea) {
        return ' -not -wholename "*' + ea + '*"';
      })
      .join(' ');
    cmd +=
      ' | while read file; do grep -H "' +
      pattern +
      '" "$file" ; done | cut -b 1-200';
    return respondWithCMD(cmd, res);
  }
}
