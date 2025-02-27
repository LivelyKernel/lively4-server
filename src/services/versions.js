import Service from "./service.js";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';

export default class VersionsService extends Service {

  async getVersion(repositorypath, filepath) {
    return (await run(
      `cd "${repositorypath}"; git log -n 1 --pretty=format:%H -- "${filepath}"`
    )).stdout;
  }
}