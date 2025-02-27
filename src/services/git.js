import Service from './service.js';
import { cleanString, run, respondWithCMD, logRequest } from '../utils.js';
import Path from 'path';

const RepositoryInSync = {}; // cheap semaphore

export default class GITService extends Service {

  async request(pathname, req, res) {
    logRequest(req, 'git control: ' + pathname);

    var dryrun = req.headers['dryrun'];
    dryrun = dryrun && dryrun == 'true';
    // #TODO replace it with something more secure... #Security #Prototype
    // Set CORS headers
    var repository = req.headers['gitrepository'];
    var repositoryurl = req.headers['gitrepositoryurl'];
    var username = req.headers['gitusername'];
    var password = req.headers['gitpassword'];
    var email = req.headers['gitemail'];
    var branch = req.headers['gitrepositorybranch'];
    var msg = req.headers['gitcommitmessage'] && cleanString(req.headers['gitcommitmessage']);
    var filepath = req.headers['gitfilepath'];
    var gitcommit = req.headers['gitcommit'];
    var usecolor = req.headers['gitusecolor'];

    var versionA = req.headers['gitversiona'];
    var versionB = req.headers['gitversionb'];

    var repositorypath = Path.join(this.server.sourceDir, repository)

    if (!email) {
      return res.end('please provide email!');
    }
    if (!username) {
      return res.end('please provide username');
    }
    if (!password) {
      return res.end('please login');
    }

    if (!repository) {
      return res.end('please specify repository');
    }

    repository = repository.replace(/^\//, "") // #TODO should we take care of this in the client?

    var cmd;
    if (pathname.match(/\/_git\/sync/)) {
      logRequest(req, 'SYNC REPO ' + RepositoryInSync[repository]);
      if (RepositoryInSync[repository]) {
        return respondWithCMD(
          'echo Sync in progress: ' + repository,
          res,
          dryrun
        );
      }
      RepositoryInSync[repository] = true;
      try {
        cmd = `${this.server.serverDir}/bin/lively4sync.sh '${this.server.lively4DirUnix +
          '/' +
          repository}' '${username}' '${password}' '${email}' '${branch}' '${msg}'`;
        const result = await run(cmd);

        // Check for authentication/credential errors in stderr
        if (result.stderr && (
          result.stderr.includes('Authentication failed') ||
          result.stderr.includes('fatal: could not read Username') ||
          result.stderr.includes('fatal: Authentication failed')
        )) {
          res.writeHead(401); // Unauthorized
          res.end('Git authentication failed. Please check your credentials.');
          return;
        }

        // If we get here, send the normal response
        res.writeHead(200);
        res.end(result.stdout + '\n' + result.stderr);

        logRequest(req, "delete bundle: " + repositorypath);
        await this.server.bundleService.deleteBundleFile(repositorypath);
      } catch (error) {
        res.writeHead(500);
        res.end('Git sync failed: ' + error.message);
      } finally {
        RepositoryInSync[repository] = undefined;
      }
    } else if (pathname.match(/\/_git\/resolve/)) {
      cmd =
        `${this.server.serverDir}/bin/lively4resolve.sh '` +
        this.server.lively4DirUnix +
        '/' +
        repository +
        "'";
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/status/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};
        git -c color.status=always  status ; git log --color=always HEAD...origin/${branch} --pretty="format:%h\t%aN\t%cD\t%f"`;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/log/)) {
      cmd =
        'cd ' + this.server.lively4DirUnix + '/' + repository + '; git log --color=always';
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/graph/)) {
      cmd =
        'cd ' +
        this.server.lively4DirUnix +
        '/' +
        repository +
        '; git log --graph -100 --color=always';
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/commit/)) {
      if (!msg) {
        return res.end('Please provide a commit message!');
      }
      cmd =
        "cd '" +
        this.server.lively4DirUnix +
        '/' +
        repository +
        "';\n" +
        'git config user.name ' +
        username +
        ';\n' +
        'git config user.email ' +
        email +
        ';\n' +
        // "git commit "+ msg +" -a ";
        `if [ -e ".git/MERGE_HEAD" ];
        then
          echo "merge in progress - you had conflicts or a manual merge is in progress";
        else
          git commit -m'${msg}' -a ;
        fi`;

      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/diff/)) {
      var commit = 'origin/' + branch;
      if (gitcommit) {
        commit = gitcommit + '~1 ' + gitcommit;
      }
      cmd = `cd ${this.server.lively4DirUnix}/${repository}; git diff --word-diff --color=always ${commit}`;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/clone/)) {
      let url = repositoryurl.replace("https://", `https://${username}:${password}@`)
      cmd =
        `cd ${this.server.lively4DirUnix}; \n` +
        'git clone --recursive ' +
        url +
        ' ' +
        repository + `;\n` + // this will leave the password in the config
        `cd ${this.server.lively4DirUnix}/${repository}; \n` +
        // #TODO can we avoid the and prevent the storing of username and password in the first place, e.g. is there is method of handing git the usename and password without encoding them in the url?
        // remove the username password from the config       
        `git remote set-url origin ${repositoryurl}`

      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/checkout/)) {

      logRequest(req, 'CHECKOUT REPO ' + RepositoryInSync[repository] + " " + filepath);

      // #TODO we should merge this semaphore logic...
      if (RepositoryInSync[repository]) {
        return respondWithCMD(
          'echo Sync in progress: ' + repository,
          res,
          dryrun
        );
      }
      RepositoryInSync[repository] = true;
      // checkout single file directly from origin server... without pulling in other changes
      // WARNING: the changes will appear as local changes but should be resolved by the merge later
      // from git's standpoint it will appeach as two changes with the same content
      let url = repositoryurl.replace("https://", `https://${username}:${password}@`)
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` +
        `git remote set-url origin ${url};\n` +
        `git fetch; \n` +
        `git checkout origin/${branch} -- ${filepath}; \n` +
        `git remote set-url origin ${repositoryurl}`

      await respondWithCMD(cmd, res, dryrun);
      RepositoryInSync[repository] = undefined;
    } else if (pathname.match(/\/_git\/npminstall/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` + 'npm install';
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/npmtest/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` + 'npm test';
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/remoteurl/)) {
      cmd =
        `cd ${this.server.lively4DirUnix}/${repository};\n` +
        'git config --get remote.origin.url';
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/branches$/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` + 'git branch -a ';
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/branch$/)) {
      cmd =
        `${this.server.serverDir}/bin/lively4branch.sh '${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/merge$/)) {
      cmd =
        `${this.server.serverDir}/bin/lively4merge.sh '${this.server.lively4DirUnix}/${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/squash$/)) {
      cmd =
        `${this.server.serverDir}/bin/lively4squash.sh '${this.server.lively4DirUnix}/${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}' '${msg}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/delete$/)) {
      cmd = `${this.server.serverDir}/bin/lively4deleterepository.sh '${this.server.lively4DirUnix}/${repository}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/show$/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` + `git show ${usecolor ? " --color=always " : ""}` + gitcommit;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/reset$/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` + `git reset --hard origin/${branch}`;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/mergebase$/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` + `git merge-base ${versionA} ${versionB} `;
      respondWithCMD(cmd, res, dryrun);
    } else if (pathname.match(/\/_git\/reset-hard/)) {
      cmd = `cd ${this.server.lively4DirUnix}/${repository};\n` + `git reset --hard origin/${branch}`;
      respondWithCMD(cmd, res, dryrun);
    } else {
      res.writeHead(200);
      res.end('Lively4 git Control! ' + pathname + ' not implemented!');
    }
  }
}
