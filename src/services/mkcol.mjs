import Service from "./service.mjs";
import Path from 'path';
import { run } from "../utils.js";

/**
 * MKCOL Service class implements WebDAV MKCOL method for creating directories
 * @extends Service
 */
export default class MKCOL extends Service {

  /**
   * Handles MKCOL request to create a new directory
   * @param {string} repositorypath - Base path of the repository
   * @param {string} filepath - Relative path where the directory should be created
   * @param {http.ServerResponse} res - HTTP response object
   * @returns {Promise<void>} - Resolves when directory creation is complete
   */
  async request(repositorypath, filepath, res) {
    let fullpath = Path.join(repositorypath, filepath)
    // #TODO check for existing directory and return 409 ?
    var result = await run(`mkdir -v "${fullpath}"`);
    if (result.error) {
      res.writeHead(404);
      return res.end("Error " + result.stdout + "\n" + result.stderr);
    }
    res.writeHead(200);
    res.end("created directory: " + fullpath);
  }
}