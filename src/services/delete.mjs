import Service from "./service.mjs";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, } from '../utils.js';

/**
 * DELETE Service - Handles file and directory deletion requests
 * @extends Service
 */
export default class DELETE extends Service {

    /**
     * Deletes a file or directory at the specified path
     * @param {string} fullpath - Absolute path to the file or directory to delete
     */
    static async deletePath(fullpath) {
        return run(
            `f="${fullpath}";
          if [ -d "$f" ]; then rmdir -v "$f"; else rm -v "$f"; fi`)
    }

    /**
     * Handles the DELETE HTTP request
     * @param {string} repositorypath - Base path of the repository
     * @param {string} filepath - Relative path to the target file within the repository
     * @param {http.ServerResponse} res - HTTP response object
     */
    async request(repositorypath, filepath, res) {
        // Construct absolute path by joining repository path and file path
        let fullpath = Path.join(repositorypath, filepath)

        // Delete associated cache files first
        await DELETE.deletePath(this.server.optionsPath(repositorypath, filepath))
        await DELETE.deletePath(this.server.transpileService.transpilePath(repositorypath, filepath))

        // Delete the actual file/directory
        var result = await DELETE.deletePath(fullpath)
        if (result.error) {
            res.writeHead(404)
            return res.end("Error " + result.stdout + "\n" + result.stderr)
        }
        res.writeHead(200)
        res.end("deleted " + fullpath)
    }
}