/** 
 * @module FilesService
 */

import Service from "./service.js";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';
import mime from 'mime-types';
import fs from 'fs';

/**
 * Service for handling file operations in the server
 * @extends Service
 */
export default class FilesService extends Service {

  /**
   * Gets the last modification timestamp for a file
   * @param {string} repositorypath - Path to the repository
   * @param {string} filepath - Path to the file within the repository
   * @returns {Promise<string>} - A promise resolving to the last modification timestamp
   */
  async getLastModified(repositorypath, filepath) {
    return (await run(
      `cd "${repositorypath}"; find "${filepath}" -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS"`
    )).stdout;
  }

  /**
   * Validates a file path to prevent directory traversal and other security issues
   * @param {string} path - The path to validate
   * @returns {boolean} - True if the path is valid, false otherwise
   */
  validatePath(path) {
    // First check for special characters
    if (path.match(/['";&#?:|]/)) {
      return false;
    }

    // Check for directory traversal attempts
    // Normalize the path first to resolve any ../ sequences
    const normalizedPath = Path.normalize(path);

    // Check if the normalized path tries to go above root with ../
    if (normalizedPath.startsWith('..') || normalizedPath.includes('/../')) {
      return false;
    }

    return true;
  }

  /**
   * Reads a file and sends it as an HTTP response
   * @param {string} repositorypath - Path to the repository
   * @param {string} filepath - Path to the file within the repository
   * @param {Object} req - HTTP request object
   * @param {Object} res - HTTP response object
   * @returns {Promise<void>}
   */
  async readFile(repositorypath, filepath, req, res) {
    // First validate the path before attempting to read
    if (!this.validatePath(filepath)) {
      res.writeHead(500);
      res.end('Invalid path: directory traversal not allowed');
      return;
    }

    var fullpath = Path.join(repositorypath, filepath);

    try {
      var stats = await fs_stat(fullpath);
    } catch (e) {
      // nothing
    }

    if (!stats) {
      console.log('FILE DOES NOT EXIST ' + fullpath)
      res.writeHead(404);
      return res.end('File not found!\n');
    }
    if (stats.isDirectory()) {
      this.server.directoryService.readDirectory(fullpath, req, res, 'text/html');
    } else {
      res.writeHead(200, {
        'content-type': mime.lookup(fullpath),
        fileversion: await this.server.versionsService.getVersion(repositorypath, filepath),
        modified: await this.server.filesService.getLastModified(repositorypath, filepath)
      });
      var stream = fs.createReadStream(fullpath, {
        bufferSize: 64 * 1024
      });
      stream.on('error', function (err) {
        log('error reading: ' + fullpath + ' error: ' + err);
        res.end('Error reading file\n');
      });
      stream.pipe(res);
    }
  }

  /**
   * Reads a specific version of a file through git and sends it as an HTTP response
   * @param {string} repositorypath - Path to the repository
   * @param {string} filepath - Path to the file within the repository
   * @param {string} fileversion - Git version/commit hash of the file to retrieve
   * @param {Object} req - HTTP request object
   * @param {Object} res - HTTP response object
   * @returns {Promise<void>}
   */
  async readFileVersion(repositorypath, filepath, fileversion, req, res) {
    // Try git show with the specific commit hash, avoiding any remote references
    var { stdout, stderr, error } = await run(
      `cd "${repositorypath}"; git show "${fileversion}":"${filepath}"`,
      res
    );
    var headers = {}
    headers['Content-Type'] = mime.lookup(filepath);
    headers['fileversion'] = fileversion;

    if (error == null) {
      res.writeHead(200, headers);
      res.end(stdout);
    } else {
      // If git show fails, try to check if the commit exists locally first
      var { stdout: commitCheck, error: commitError } = await run(
        `cd "${repositorypath}"; git cat-file -e "${fileversion}" 2>/dev/null && echo "exists" || echo "missing"`
      );
      
      if (commitError || commitCheck.trim() === "missing") {
        res.writeHead(404, headers);
        res.end(`Commit ${fileversion} not found in local repository`);
      } else {
        // Commit exists but file might not exist at that commit
        res.writeHead(404, headers);
        res.end(`File ${filepath} not found at commit ${fileversion}`);
      }
    }
  }

}