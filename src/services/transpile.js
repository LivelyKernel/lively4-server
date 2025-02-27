import Service from "./service.js";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';

/**
 * Service class for handling file transpilation operations
 * @extends Service
 */
export default class TranspileService extends Service {

  /**
   * Invalidates (removes) transpiled files for a given source file
   * @param {string} repositorypath - The path to the repository
   * @param {string} filepath - The path to the source file
   * @param {Object} req - The HTTP request object for logging
   * @returns {Promise<void>}
   */
  async invalidateTranspiledFile(repositorypath, filepath, req) {
    if (filepath.match(this.Config.transpileDir)) return  // don't do it on yourself
    if (!filepath.match(/\.js/)) return  // only javascript files are transpiled...

    logRequest(req, "invalidate transpilation files" + this.Config.bundleName + " in " + repositorypath)
    var hashedpath = filepath.replace(/\//g, "_")
    var result = await run(`cd ${repositorypath}; 
        if [ -e ${this.Config.transpileDir} ]; then
          rm ${this.Config.transpileDir}/${hashedpath}
          rm ${this.Config.transpileDir}/${hashedpath}.map.json
        fi`)
    logRequest(req, "RESULT " + result.stdout)
  }

  /**
   * Generates the path where a transpiled file should be stored
   * @param {string} repositorypath - The path to the repository
   * @param {string} filepath - The path to the source file
   * @returns {string} The full path where the transpiled file should be stored
   */
  transpilePath(repositorypath, filepath) {
    return repositorypath + "/" + this.Config.transpileDir + "/" + filepath.replace(/\//g, "_")
  }
}