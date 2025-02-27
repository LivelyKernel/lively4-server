import Service from "./service.js";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';

export default class TranspileService extends Service {

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

  transpilePath(repositorypath, filepath) {
    return repositorypath + "/" + this.Config.transpileDir + "/" + filepath.replace(/\//g, "_")
  }
}