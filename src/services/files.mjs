import Service from "./service.mjs";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';
import mime from 'mime-types';
import fs from 'fs';


export default class FilesService extends Service {


  async getLastModified(repositorypath, filepath) {
    return (await run(
      `cd "${repositorypath}"; find "${filepath}" -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS"`
    )).stdout;
  }


  async readFile(repositorypath, filepath, req, res) {
    // First validate the path before attempting to read
    if (!this.server.validatePath(filepath)) {
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


  /* load a specific version of a file through git */
  async readFileVersion(repositorypath, filepath, fileversion, req, res) {
    var { stdout, stderr, error } = await run(
      'cd ' + repositorypath + ';' + 'git show ' + fileversion + ':"' + filepath + '"',
      res
    );
    var headers = {}
    headers['Content-Type'] = mime.lookup(filepath);
    // console.log("[readfile version] stderr " + stderr )
    // console.log("[readfile version] err ", error == null )

    // ok, this is not easy to figure out

    // console.log("[readfile version] version ", fileversion )

    headers['fileversion'] = fileversion;

    if (error == null) {
      res.writeHead(200, headers);
      res.end(stdout);
    } else {
      // console.log("ERROR ERROR 300")
      res.writeHead(300, headers);
      res.end(stdout + stderr);
    }
  }

}