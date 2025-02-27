import Service from "./service.js";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';

/**
 * Service class for handling version control operations
 * @extends Service
 */
export default class VersionsService extends Service {

  /**
   * Gets the latest commit hash for a specific file in a repository
   * @param {string} repositorypath - The path to the git repository
   * @param {string} filepath - The path to the file within the repository
   * @returns {Promise<string>} The commit hash of the latest commit for the file
   */
  async getVersion(repositorypath, filepath) {
    return (await run(
      `cd "${repositorypath}"; git log -n 1 --pretty=format:%H -- "${filepath}"`
    )).stdout;
  }
}