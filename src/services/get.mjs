import Service from "./service.mjs";
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';
import mime from 'mime-types';
import Path from 'path';
import fs from 'fs';


export default class GET extends Service {

    async request(repositorypath, filepath, fileversion, req, res) {
        if (filepath.match(this.Config.bundleName)) {
            return this.server.bundleService.ensureBundleFile(repositorypath, filepath, req, res);
        } else if (fileversion && fileversion != 'undefined') {
            return this.server.filesService.readFileVersion(repositorypath, filepath, fileversion, req, res);
        } else {
            return this.server.filesService.readFile(repositorypath, filepath, req, res);
        }
    }

    

}
