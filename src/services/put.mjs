import Service from "./service.mjs";
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';
import mime from 'mime-types';
import Path from 'path';
import fs from 'fs';

/* write file to disk */

const RepositoryGitInUse = {}; // cheap semaphore
const isTextRegEx = /\.((`txt)|(md)|(js)|(html)|(svg))$/;

export default class PUT extends Service {

    async request(repositorypath, filepath, req, res) {
        var fullpath = Path.join(repositorypath, filepath);
        var fullBody = '';
        if (filepath.match(isTextRegEx)) {
            // #TODO how do we better decide if we need this.server...
        } else {
            logRequest(req, 'set binary encoding');
            req.setEncoding('binary');
        }

        //read chunks of data and store it in buffer
        req.on('data', function (chunk) {
            fullBody += chunk.toString();
        });

        await new Promise(resolve => req.on('end', resolve))

        // after transmission, write file to disk

        // only block at the end...
        await this.server.optionsService.invalidateOptionsFile(repositorypath, filepath, req)
        await this.server.transpileService.invalidateTranspiledFile(repositorypath, filepath, req,)
        await this.server.bundleService.invalidateBundleFile(repositorypath, filepath, req)
        await this.server.ensureSpecialParentDirectories(repositorypath, filepath, req)

        if (fullpath.match(/\/$/)) {
            return await mkdir(fullpath, err => {
                if (err) {
                    logRequest(req, 'Error creating dir: ' + err);
                }
                logRequest(req, 'mkdir ' + fullpath);
                res.writeHead(200, 'OK');
                res.end();
            });
        }
        var lastVersion = req.headers['lastversion'];
        var currentVersion = await this.server.versionsService.getVersion(repositorypath, filepath);

        // we have version information and there is a conflict
        if (lastVersion && currentVersion && lastVersion !== currentVersion) {
            logRequest(req, '[writeFile] CONFLICT DETECTED');
            res.writeHead(409, {
                // HTTP CONFLICT
                'content-type': 'text/plain',
                conflictversion: currentVersion
            });
            res.end('Writing conflict detected: ' + currentVersion);
            return;
        }

        try {
            await fs_writeFile(fullpath, fullBody, fullpath.match(isTextRegEx) ? undefined : 'binary');
        } catch (err) {
            logRequest(req, err);
            throw new Error("Error in writeFile " + fullpath + ": " + err);
        }

        if (!this.server.autoCommit || req.headers['nocommit']) {
            // logRequest(req, 'saved ' + fullpath);
            res.writeHead(200, 'OK');
            res.end();
            return
        }

        if (RepositoryGitInUse[repositorypath]) {
            logRequest(req, '[writeFile] Autocommit failed');
            res.writeHead(300, 'Autocommit failed');
            return res.end('Autocommit failed, repository in use: ' + repositorypath);
        }
        RepositoryGitInUse[repositorypath] = true;

        var username = req.headers.gitusername;
        var email = req.headers.gitemail;
        // var password = req.headers.gitpassword; // not used yet

        var authCmd = '';
        if (username) authCmd += `git config user.name '${username}'; `;
        if (email) authCmd += `git config user.email '${email}'; `;
        // logRequest(req, 'EMAIL ' + email + ' USER ' + username);

        // #TODO maybe we should ask for github credetials here too?
        let cmd = `
      cd "${repositorypath}"; 
      if [ -e .git ]; then
        ${authCmd} git add "${filepath}"; 
        git commit -m "AUTO-COMMIT ${filepath}"
      else
        echo "no git repository" 
      fi
    `;
        try {
            let { error, stdout, stderr } = await run(cmd)
            // logRequest(req, 'git stdout: ' + stdout);
            // logRequest(req, 'git stderr: ' + stderr);
            if (error) {
                // file did not change....
                if (!stdout.match("no changes added to commit")) {
                    logRequest(req, 'ERROR ' + JSON.stringify(stderr));
                    res.writeHead(500, 'Error:' + JSON.stringify(stderr));
                    return res.end('ERROR stdout: ' + stdout + "\nstderr:" + stderr);
                }
            }
        } finally {
            RepositoryGitInUse[repositorypath] = undefined;
        }
        var { options, body, error } = await this.ensureCachedOptions(repositorypath, filepath)
        if (!options) {
            res.writeHead(500);
            res.end('could not retrieve new version... somthing went wrong: ' + error);
        } else {
            res.writeHead(200, {
                'content-type': 'text/plain',
                fileversion: options.version,
            });
            res.end(body);
        }
    }

    async ensureCachedOptions(repositorypath, filepath) {
        console.log("ensureCachedOptions " + repositorypath + ", " + filepath)
        let options = await this.server.optionsService.readOptions(repositorypath, filepath)
        if (options.error) {
            return { options: null, body: null, error: options.error }
        } else {
            console.log("options: " + options)
            var optionsBody = JSON.stringify(options, null, 2)
            let optionsPath = this.server.optionsService.optionsPath(repositorypath, filepath)
            return { options, body: optionsBody, written: fs_writeFile(optionsPath, optionsBody) }
        }
    }
}
