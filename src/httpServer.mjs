"disable livecode"
/*
 * # Lively4 Server -- a file server that serves and manages git repositories as REST
 *
 * ## Supported HTTP Methods:
 * - GET - Read files and directories
 * - PUT - Write files
 * - DELETE - Remove files and directories
 * - MKCOL - Create directories
 * - MOVE - Move/rename files and directories
 * - OPTIONS - Get metadata and directory listings
 * 
 * ## Special Endpoints:
 * - /_git/* - Git operations (sync, commit, clone, etc)
 * - /_meta/* - Server control operations
 * - /_tmp/* - Temporary file storage
 * - /_webhook/* - GitHub webhook handling
 * - /_curl/* - URL fetching proxy
 * - /_search/* - File content search
 * - /_bibtex/* - BibTeX search
 * - /_graphviz/* - Graphviz diagram generation
 * - /_make/* - Make command execution
 * - /_open/* - Open files externally
 *
 * ## Special Request Headers:
 * - fileversion - Get specific git version of file
 * - gitusername - Git authentication
 * - gitpassword - Git authentication
 * - gitemail - Git commit author
 * - gitrepository - Target repository
 * - gitrepositoryurl - Repository URL for cloning
 * - gitrepositorybranch - Target branch
 * - gitcommitmessage - Commit message
 * - gitfilepath - File path for git operations
 * - gitcommit - Specific commit for git operations
 * - gitusecolor - Enable colored git output
 * - searchpattern - Pattern for file search
 * - rootdirs - Root directories for search
 * - excludes - Paths to exclude from search
 * - graphlayout - Layout engine for graphviz
 * - showversions - List file versions in OPTIONS
 * - filelist - Get recursive directory listing in OPTIONS
 */

// Core Node.js imports
import http from 'http';
import fs from 'fs';
import URL from 'url';
import Path from 'path';
import { mkdir } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

// Third-party imports
import httpProxy from 'http-proxy';
import mime from 'mime-types';
import argv from 'argv';
import slash from 'slash'; // Convert Windows backslash paths to slash paths: foo\\bar ➔ foo/bar
import 'log-timestamp'; // this adds a timestamp to all log messages
import fetch from 'node-fetch';

// Local imports
import * as utils from './utils.js';
import { cleanString, run, respondWithCMD } from './utils.js';

// Promisified fs functions
const fs_exists = function (file) {
  return new Promise(resolve =>
    fs.exists(file, exists => {
      resolve(exists);
    })
  );
};
const fs_stat = promisify(fs.stat);
const fs_readdir = promisify(fs.readdir);
const fs_writeFile = promisify(fs.writeFile);
const fs_readFile = promisify(fs.readFile);

// Cache objects
const GithubOriganizationMemberCache = {};
const RepositoryBootfiles = {};
const RepositoryInSync = {}; // cheap semaphore
const MakeInProgress = {}; // cheap semaphore 
const RepositoryGitInUse = {}; // cheap semaphore

// Regex constants
const breakOutRegex = new RegExp('/*\\/\\.\\.\\/*/');
const isTextRegEx = /\.((txt)|(md)|(js)|(html)|(svg))$/;

// Logging functions
export function log(...args) {
  console.log('[server]', ...args);
}

// #UseCase #ContextJS #AsyncContext it is really hard to hand down the request object into all methods, just so they can log properly...
export function logRequest(req, ...args) {
  log("REQUEST[" + req._logId + "] ", ...args);
}

// Helper functions
async function try_fs_stat(file) {
  try {
    return await fs_stat(file)
  } catch (e) {
    return null
  }
}

export class Server {
  static Config = {
    bootfilelistName: ".lively4bootfilelist",
    bundleName: ".lively4bundle.zip", 
    transpileDir: ".transpiled",
    optionsDir: ".options"
  };

  static get optionsSpec() {
    return [
      {
        name: 'port',
        short: 'p',
        type: 'int',
        description: 'port on which the server will listen for connections',
        example:
          "'node httpServer.js -p 8001' or 'node httpServer.js --port=8001'"
      },
      {
        name: 'directory',
        short: 'd',
        type: 'path',
        description: 'root directory from which the server will serve files',
        example:
          "'node httpServer.js -d ../foo/bar' or node httpServer.js --directory=../foo/bar'"
      },
      {
        name: 'server',
        type: 'path',
        description: 'directory where the server looks for its scripts',
        example: "'node httpServer.js --server ~/lively4-server'"
      },
      {
        name: 'auto-commit',
        type: 'boolean',
        description: 'auto commit on every PUT file',
        example: "'node --auto-commit=true'"
      },
      {
        name: 'bash-bin',
        type: 'string',
        description: 'path to bash executable',
        example: "'node --bash-bin=\\cygwin64\\bin\\bash.exe'"
      },
      {
        name: 'lively4dir-unix',
        type: 'string',
        description: 'the directory in cygwin.'
      },
      {
        name: 'authorize-requests',
        type: 'boolean',
        description: 'authorize every request by authenticating a user and checking if in github team'
      },
      {
        name: 'github-organization',
        type: 'string',
        description: 'github organization'
      },
      {
        name: 'github-team',
        type: 'string',
        description: 'github team'
      },
      {
        name: 'myurl',
        type: 'string',
        description: 'myurl from the outside...'
      },
      {
        name: 'tmp-cleanup-timeout',
        type: 'int',
        description: 'timeout in milliseconds after which temporary files are cleaned up',
        example: "'node httpServer.js --tmp-cleanup-timeout=300000'"
      }
    ];
  }

  static setup() {
    this.port = port;
    this.server = server;
  }

  static get lively4dir() {
    return lively4dir;
  }

  static set lively4dir(path) {
    log('set lively4dir to:' + path);
    sourceDir = path;
    lively4dir = path;
    lively4DirUnix = path;
    return lively4dir;
  }

  static get autoCommit() {
    return autoCommit;
  }

  static set autoCommit(bool) {
    log('set autoCommit to: ' + bool);
    return (autoCommit = bool);
  }


  static start() {
    log('Welcome to Lively4!');
    log('Server: ' + this.server);
    log('Lively4: ' + lively4dir);
    log('Port: ' + this.port);
    log('Auto-commit: ' + autoCommit);
    log('Myurl: ' + Server.options.myurl);

    this.tmpStorage = {};
    this.tmpStorageTimeouts = new Map(); // Track timeouts
    this.requestCounter = 0;
    this.activeSockets = new Set(); // Track active sockets

    var proxy = httpProxy.createProxyServer({});

    this.httpServer = http
      .createServer((req, res) => this.onRequest(req, res, proxy))
      .listen(this.port, (err) => {
        if (err) {
          throw err;
        }
        this.isRunning = true;
        log('Server running on port ' + port + ' in directory ' + sourceDir);
      });

    // Track new connections
    this.httpServer.on('connection', socket => {
      this.activeSockets.add(socket);
      socket.on('close', () => {
        this.activeSockets.delete(socket);
      });
    });
  }

  static async stop() {
    this.isRunning = false;

    // Clear all timeouts
    if (this.tmpStorageTimeouts) {
      for (let timeout of this.tmpStorageTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.tmpStorageTimeouts.clear();
    }

    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve(); // Server was never started
        return;
      }

      // Force close all tracked sockets
      for (const socket of this.activeSockets) {
        console.log("FORCE CLOSE SOCKET" + socket);
        socket.destroy();
      }
      this.activeSockets.clear();

      this.httpServer.close((err) => {
        if (err) {
          log('Error closing server: ' + err);
          reject(err);
        } else {
          log('Server closed');
          resolve();
        }
      });
    });
  }
  static setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, DELETE, PUT, MOVE');
    res.setHeader('Access-Control-Allow-Headers', '*');
  }

  static validatePath(path) {
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

  static async onRequest(req, res, proxy) {
    req._logId = this.requestCounter++
    req._startTime = Date.now()
    logRequest(req, "START " + req.method + "\t" + req.url)
    try {
      var debugInitiator = req.headers['debug-initiator'];
      if (debugInitiator) {
        logRequest(req, "INITIATOR " + debugInitiator)
      }
      var debugSession = req.headers['debug-session'];
      if (debugSession) {
        logRequest(req, "SESSION " + debugSession)
      }

      var debugSystem = req.headers['debug-system'];
      if (debugSystem) {
        logRequest(req, "SYSTEM " + debugSystem)
      }

      var debugEventid = req.headers['debug-eventid'];
      if (debugEventid) {
        logRequest(req, "EVENTID " + debugEventid)
      }


      var startRequestTime = Date.now()


      try {
        this.setCORSHeaders(res);

        var url = URL.parse(req.url, true, false);
        var pathname = url.pathname;

        // Validate path before any processing
        if (!this.validatePath(pathname)) {
          res.writeHead(500);
          res.end('Invalid path: directory traversal not allowed');
          return;
        }

        pathname = pathname.replace(/['";&?:#|]/g, ''); // keep this as a secondary safety measure
        var path = decodeURI(slash(Path.normalize(pathname)));  // windows compat.....
        var fileversion = req.headers['fileversion'];

        var m = path.match(/^\/([^/]*)\/(.*)/)

        if (m) {
          var repositorypath = Path.join(sourceDir, m[1]);
          var filepath = m[2]
        } else {
          repositorypath = sourceDir
          filepath = path
        }

        // log("authorize-requests: " + this.options["authorize-requests"])
        if (this.options["authorize-requests"]) {
          // log("AUTH REQUIRED")

          var org = this.options["github-organization"]
          if (!org) {
            logRequest(req, "CONFIG ERROR: github-organization is missing")
          }
          var teamName = this.options["github-team"]
          if (!teamName) {
            logRequest(req, "CONFIG ERROR: github-team is missing")
          }

          var username = req.headers['gitusername'];
          var password = req.headers['gitpassword'];

          // log("user " + username)
          // log("password " + (password + "").slice(0,3))

          if (!username || !password) {
            res.writeHead(403);
            res.end('Please authenticate yourself\n');
            return;
          }

          // cache the authorization to go light on the github API and answer faster ourselves
          var authorizationKey = org + "/" + org + "/" + username + "/" + password
          var lastAuthorization = GithubOriganizationMemberCache[authorizationKey]
          if (lastAuthorization && lastAuthorization.success) {
            logRequest(req, "AUTHORIZED BY CACHE")
            // do nothing
          } else {
            logRequest(req, "AUTHORIZATION required org: " + org + " team: " + teamName)
            let teamInfo = await fetch(`https://api.github.com/orgs/${org}/teams/${teamName}`, {
              method: "GET",
              headers: {
                Authorization: "token " + password
              }
            }).then(r => r.json());

            if (teamInfo.members_url) {
              var members = await fetch(teamInfo.members_url.replace(/\{.*/, ""), {
                method: "GET",
                headers: {
                  Authorization: "token " + password
                }
              }).then(r => r.json());
              var userInTeam = members.map(ea => ea.login).includes(username)
            }

            if (!userInTeam) {
              GithubOriganizationMemberCache[authorizationKey] = {
                success: false,
                time: Date.now(),
                previous: lastAuthorization // for preventing... DoS attacks? #TODO
              }
              res.writeHead(403);
              res.end('Authentification/Authorization failed\n');
              return;
            }

            GithubOriganizationMemberCache[authorizationKey] = {
              success: true,
              time: Date.now()
            }
          }
        }

        logRequest(req, `${req.method} ${path}  ${fileversion ? '[version= ' + fileversion + ']' : ''}`);
        // logRequest(req, `repositorypath: ${repositorypath} filepath: ${filepath}`);

        if (breakOutRegex.test(path) === true) {
          res.writeHead(500);
          res.end(
            'Your not allowed to access files outside the pages storage area\n'
          );
          return;
        }

        if (pathname.match(/\/_tmp\//)) {
          return this.TMP(pathname, req, res);
        }

        if (pathname.match(/\/_meta\//)) {
          return this.META(pathname, req, res);
        }
        if (pathname.match(/\/_webhook\//)) {
          return this.WEBHOOK(pathname, req, res);
        }
        if (path.match(/\/_git.*/)) {
          return this.GIT(path, req, res);
        }
        if (path.match(/\/_graphviz.*/)) {
          return this.GRAPHVIZ(path, req, res); // #TODO auth should be required 
        }
        if (path.match(/\/_make.*/)) {
          return this.MAKE(path, req, res); // #TODO auth should be required
        }
        if (path.match(/\/_open.*/)) {
          return this.OPEN(path, req, res); // #TODO auth should be required
        }
        if (pathname.match(/\/_curl\//)) {
          return this.CURL(pathname, req, res);
        }
        if (pathname.match(/\/_search\//)) {
          return this.SEARCH(pathname, req, res);
        }
        if (pathname.match(/\/_bibtex/)) {
          return this.BIBTEX(pathname, req, res);
        }
        if (req.method == 'GET') {
          await this.GET(repositorypath, filepath, fileversion, req, res);
        } else if (req.method == 'PUT') {
          await this.PUT(repositorypath, filepath, req, res);
        } else if (req.method == 'DELETE') {
          await this.DELETE(repositorypath, filepath, res);
        } else if (req.method == 'MKCOL') {
          await this.MKCOL(repositorypath, filepath, res);
        } else if (req.method == 'OPTIONS') {
          await this.OPTIONS(repositorypath, filepath, req, res);
        } else if (req.method == 'MOVE') {
          await this.MOVE(repositorypath, filepath, req, res);
        }
      } catch (e) {
        console.error('ERROR on request ' + req.url, e);
        res.writeHead(500);
        res.end('ERROR: ' + e);
      }
    } finally {
      logRequest(req, "FINISHED " + req.method + " (" + Math.round(Date.now() - startRequestTime) + "ms) " + req.url + " ")
    }
  }

  static GET(repositorypath, filepath, fileversion, req, res) {
    if (filepath.match(Server.Config.bundleName)) {
      return this.ensureBundleFile(repositorypath, filepath, req, res);
    } else if (fileversion && fileversion != 'undefined') {
      return this.readFileVersion(repositorypath, filepath, fileversion, req, res);
    } else {
      return this.readFile(repositorypath, filepath, req, res);
    }
  }

  static hashFilepath(filepath) {
    return filepath.replace(/\//g, "_")
  }

  static async ensureBundleFile(repositorypath, bundleFilepath, req, res) {
    var bundleFile = Path.join(repositorypath, bundleFilepath)
    if (!await fs_exists(bundleFile)) {
      logRequest(req, "CREATE BUNDLE for " + repositorypath)
      await this.ensureDirectory(repositorypath, Server.Config.optionsDir)
      let optionsDir = Path.join(repositorypath, Server.Config.optionsDir)

      await this.ensureDirectory(repositorypath, Server.Config.transpileDir)
      let transpileDir = Path.join(repositorypath, Server.Config.transpileDir)

      try {
        var bootlist = (await fs_readFile(repositorypath + "/" + Server.Config.bootfilelistName)).toString()
      } catch (e) {
        logRequest(req, "WARNING, could not read " + Server.Config.bootfilelistName + ":" + e)
      }
      var relativeBootFiles = []
      var relativeOptionFiles = []
      var relativeTranspileFiles = []

      if (bootlist) {
        var hashed = new Map()
        for (let file of bootlist.split("\n")) {

          let filehash = this.hashFilepath(file)
          // logRequest(req, "filehash " + filehash)
          hashed.set(filehash, file)

          let filepath = Path.join(repositorypath, file)

          var stats = await try_fs_stat(filepath)
          if (!stats) {
            logRequest(req, "ignore " + filepath)
            continue;
          }
          let optionsFile = Path.join(optionsDir, filehash)
          let transpileFile = Path.join(transpileDir, filehash)
          let transpileMapFile = Path.join(transpileDir, filehash + ".json.map")

          relativeBootFiles.push(file)

          var optionsStats = await try_fs_stat(optionsFile)
          if (!optionsStats || stats.mtime > optionsStats.mtime) {
            var updatedOptions = await this.readOptions(repositorypath, filepath, stats)
            logRequest(req, "UPDATE OPTIONS " + optionsFile)
            await fs_writeFile(optionsFile, JSON.stringify(updatedOptions, null, 2))
          }
          relativeOptionFiles.push(Path.join(Server.Config.optionsDir, filehash))

          let transpileStats = await try_fs_stat(transpileFile)
          if (transpileStats) {
            if (stats.mtime > transpileStats.mtime) {
              logRequest(req, "DELETE " + transpileFile)
              await this.deletePath(transpileFile)
            } else {
              relativeTranspileFiles.push(Path.join(Server.Config.transpileDir, filehash))
            }
          }
          let transpileMapStats = await try_fs_stat(transpileMapFile)
          if (transpileMapStats) {
            if (stats.mtime > transpileMapStats.mtime) {
              logRequest(req, "DELETE " + transpileMapFile)
              await this.deletePath(transpileMapFile)
            } else {
              relativeTranspileFiles.push(Path.join(Server.Config.transpileDir, filehash + ".json.map"))

            }
          }
        }

        // DELETE not unused options/transpiled caches
        // should not be needed, because.... it will not end up in zip anyway...

        // for (let optionfile of fs.readdirSync(optionsDir)) {
        //   if (!hashed.get(optionfile)) {
        //     let filePath =  optionsDir + "/" +optionfile
        //     logRequest(req, "delete " + filePath)
        //     await this.deletePath(filePath)
        //   } 
        // }
        // for (let transpiledfile of fs.readdirSync(transpileDir)) {
        //   let filePath =  transpileDir + "/" +transpiledfile
        //   if (!hashed.get(transpiledfile)) {
        //     logRequest(req, "delete " + transpileDir + "/" + transpiledfile)
        //     await this.deletePath(filePath)
        //   }
        //   if (!hashed.get(transpiledfile.replace(/\.json.map$/,""))) {
        //     logRequest(req, "delete " + transpileDir + "/" + transpiledfile)
        //     await this.deletePath(filePath)
        //   }
        // }

      }

      let quoteList = function (list) {
        return list.map(ea => `"${ea}"`).join(" ")
      }

      var cmd = `cd ${repositorypath}; 
        if [ ! -e ${Server.Config.bundleName} ]; then
          zip -r ${Server.Config.bundleName} ${quoteList(relativeBootFiles)} ${quoteList(relativeOptionFiles)} ${quoteList(relativeTranspileFiles)};
        fi`
      // logRequest(req, "ZIP " + cmd)
      var result = await run(cmd)
      // logRequest(req, "stdout: " + result.stdout + "\nstderr: " + result.stderr)
    }
    return this.readFile(repositorypath, bundleFilepath, undefined, res)
  }



  static async isInBootfile(repositorypath, filepath) {
    console.log("isInBootfile " + Server.Config.bootfilelistName + " in " + repositorypath + " " + filepath)
    if (filepath.match(Server.Config.bootfilelistName)) {
      return true // the bootfilelist always invalidates itself...
    }

    // costs... 10ms ... so #Refactor before using it every GET requests
    var result = (await run(`cd ${repositorypath}; 
      echo ${Server.Config.bootfilelistName}
      if [ -e ${Server.Config.bootfilelistName} ]; then
        grep ${filepath} ${Server.Config.bootfilelistName}
      fi`)).stdout
    return result.match(filepath)
  }


  /* load a specific version of a file through git */
  static async readFileVersion(repositorypath, filepath, fileversion, req, res) {
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

    // not supported by git...
    // headers['modified'] =   await this.getLastModified(repositorypath, filepath);

    if (error == null) {
      res.writeHead(200, headers);
      res.end(stdout);
    } else {
      // console.log("ERROR ERROR 300")
      res.writeHead(300, headers);
      res.end(stdout + stderr);
    }
  }


  static async invalidateBundleFile(repositorypath, filepath) {
    if (filepath.match(Server.Config.transpileDir) // all compiled files are bundled?
      || await this.isInBootfile(repositorypath, filepath)) {
      log("INVALIDATE " + Server.Config.bundleName + " in " + repositorypath)
      // remove bundle if we uploaded a file that belongs into it
      await this.deleteBundleFile(repositorypath)
    } else {
      log("NOTINBOOTFILE " + repositorypath + " " + filepath)
    }
  }

  static async deleteBundleFile(repositorypath) {
    return await run(`cd ${repositorypath}; 
      if [ -e ${Server.Config.bundleName} ]; then
        rm ${Server.Config.bundleName}
      fi`)
  }

  static async ensureDirectory(path, name) {
    // #TODO do it directly in JavaScript instead of Polyglot?
    var result = await run(`cd ${path}; 
      if [ ! -e ${name} ]; then
        mkdir ${name}
      fi`)
    if (result.stderr) {
      log("ensureDirectory stderr:" + result.stderr)
    }
  }

  static async ensureSpecialParentDirectories(repositorypath, filepath, req) {
    if (filepath.match(Server.Config.transpileDir)) {
      await this.ensureDirectory(repositorypath, Server.Config.transpileDir)
    }

    // if (filepath.match(Server.Config.optionsDir)) { 
    //   await this.ensureDirectory(repositorypath, Server.Config.optionsDir)
    // }
  }

  static async invalidateOptionsFile(repositorypath, filepath, req) {
    if (filepath.match(Server.Config.optionsDir)) return  // don't do it on yourself
    if (!filepath.match(/\.js/)) return  // only javascript files are transpiled...

    logRequest(req, "invalidate options files" + Server.Config.bundleName + " in " + repositorypath)
    var hashedpath = filepath.replace(/\//g, "_")
    await run(`cd ${repositorypath}; 
        if [[ -e ${Server.Config.optionsDir}/${hashedpath} ]]; then
          rm ${Server.Config.optionsDir}/${hashedpath}
        fi`)
  }

  static async invalidateTranspiledFile(repositorypath, filepath, req) {
    if (filepath.match(Server.Config.transpileDir)) return  // don't do it on yourself
    if (!filepath.match(/\.js/)) return  // only javascript files are transpiled...

    logRequest(req, "invalidate transpilation files" + Server.Config.bundleName + " in " + repositorypath)
    var hashedpath = filepath.replace(/\//g, "_")
    var result = await run(`cd ${repositorypath}; 
        if [ -e ${Server.Config.transpileDir} ]; then
          rm ${Server.Config.transpileDir}/${hashedpath}
          rm ${Server.Config.transpileDir}/${hashedpath}.map.json
        fi`)
    logRequest(req, "RESULT " + result.stdout)
  }

  static async readFile(repositorypath, filepath, req, res) {
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
      this.readDirectory(fullpath, req, res, 'text/html');
    } else {
      res.writeHead(200, {
        'content-type': mime.lookup(fullpath),
        fileversion: await this.getVersion(repositorypath, filepath),
        modified: await this.getLastModified(repositorypath, filepath)
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

  static readDirectory(aPath, req, res, contentType) {
    fs.readdir(aPath, function (err, files) {
      var dir = {
        type: 'directory',
        contents: []
      };

      var checkEnd = () => {
        // is there a better way for synchronization???
        if (dir.contents.length === files.length) {
          var data;
          if (contentType == 'text/html') {
            // prefix the directory itself as needed if it does not end in "/"
            var match = req.url.match(/\/([^/]+)$/); // aPath stripped the / already
            var prefix = match ? match[1] + '/' : '';


            data =
              `<html><style>
  body { 
    font-family: arial;
  }
 </style><body><h1>` +
              req.url +
              '</h1>\n<ul>' +
              // '<!-- prefix=' +
              // `PATH: ${aPath} PREFIX: ${prefix} URL: ${req.url} URL2: ${JSON.stringify(req.headers)}}` +
              // ' -->' +


              dir.contents.sort()
                .map(ea => ea.name)
                .sort()
                .map(function (ea) {
                  return (
                    "<li><a href='" +
                    prefix +
                    ea +
                    "'>" +
                    ea +
                    '</a></li>'
                  );
                })
                .join('\n') +
              '</ul></body></html>';

            // github return text/plain, therefore we need to do the same
            res.writeHead(200, {
              'content-type': 'text/html'
            });
            res.end(data);
          } else {
            data = JSON.stringify(dir, null, 2);
            // github return text/plain, therefore we need to do the same
            res.writeHead(200, {
              'content-type': 'text/plain'
            });
            res.end(data);
          }
        }
      };
      checkEnd();
      files.forEach(function (filename) {
        var filePath = Path.join(aPath, filename);
        fs.stat(filePath, function (err, statObj) {
          if (!statObj) {
            dir.contents.push({
              type: 'file',
              name: filename,
              size: 0
            });
          } else if (statObj.isDirectory()) {
            dir.contents.push({
              type: 'directory',
              name: filename,
              size: 0
            });
          } else {
            dir.contents.push({
              type: 'file',
              name: filename,
              size: statObj.size
            });
          }
          checkEnd();
        });
      });
    });
  }

  /*
   * write file to disk
   */
  static async PUT(repositorypath, filepath, req, res) {
    var fullpath = Path.join(repositorypath, filepath);
    var fullBody = '';
    // if (filepath.match(/png$/)) {
    if (filepath.match(isTextRegEx)) {
      // #TODO how do we better decide if we need this...
    } else {
      logRequest(req, 'set binary encoding');
      req.setEncoding('binary');
    }

    //read chunks of data and store it in buffer
    req.on('data', function (chunk) {
      fullBody += chunk.toString();
    });

    await new Promise(resolve => req.on('end', resolve))

    //after transmission, write file to disk

    // only block at the end...
    await this.invalidateOptionsFile(repositorypath, filepath, req)
    await this.invalidateTranspiledFile(repositorypath, filepath, req,)
    await this.invalidateBundleFile(repositorypath, filepath, req)
    await this.ensureSpecialParentDirectories(repositorypath, filepath, req)

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
    var currentVersion = await this.getVersion(repositorypath, filepath);

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

    if (!autoCommit || req.headers['nocommit']) {
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

  static async ensureCachedOptions(repositorypath, filepath) {
    console.log("ensureCachedOptions " + repositorypath + ", " + filepath)
    let options = await this.readOptions(repositorypath, filepath)
    if (options.error) {
      return { options: null, body: null, error: options.error }
    } else {
      console.log("options: " + options)
      var optionsBody = JSON.stringify(options, null, 2)
      let optionsPath = this.optionsPath(repositorypath, filepath)
      return { options, body: optionsBody, written: fs_writeFile(optionsPath, optionsBody) }
    }
  }

  static optionsPath(repositorypath, filepath) {
    return repositorypath + "/" + Server.Config.optionsDir + "/" + filepath.replace(/\//g, "_")
  }

  static transpilePath(repositorypath, filepath) {
    return repositorypath + "/" + Server.Config.transpileDir + "/" + filepath.replace(/\//g, "_")
  }

  static async deletePath(fullpath) {
    return run(
      `f="${fullpath}";
      if [ -d "$f" ]; then rmdir -v "$f"; else rm -v "$f"; fi`)
  }

  /*
   * delete file
   */
  static async DELETE(repositorypath, filepath, res) {
    let fullpath = Path.join(repositorypath, filepath)

    // clear all caches associated with the file
    await this.deletePath(this.optionsPath(repositorypath, filepath))
    await this.deletePath(this.transpilePath(repositorypath, filepath))

    var result = await this.deletePath(fullpath)
    if (result.error) {
      res.writeHead(404)
      return res.end("Error " + result.stdout + "\n" + result.stderr)
    }
    res.writeHead(200)
    res.end("deleted " + fullpath)
  }

  /*
  * move file or directory
  */

  static async moveResource(source, destination) {
    return run(
      `SOURCE="${source}";
       DESTINATION="${destination}";
       mv -v "$SOURCE" "$DESTINATION";       
       `)
  }

  static async MOVE(repositorypath, filepath, req, res) {
    var source = req.url

    var destination = req.headers['destination']
    if (!destination) {
      res.writeHead(404);
      return res.end("destination parameter is missing")
    }

    var re = new RegExp(Server.options.myurl + "(.*)")
    var m = destination.match(re)

    if (m) {
      destination = m[1]
    } else {
      res.writeHead(404);
      return res.end("Server for destination and source don't match! myurl=" + Server.options.myurl)
    }

    source = Server.options.directory + decodeURI(source.substr(1))
    destination = Server.options.directory + decodeURI(destination)

    var result = await this.moveResource(source, destination)
    logRequest(req, 'MOVE from ' + source + ' to ' + destination)

    if (result.error) {
      res.writeHead(404)
      return res.end("Error " + result.stdout + "\n" + result.stderr)
    }
    res.writeHead(200)
    res.end("moved " + source + " to " + destination)

  }


  /*
   * create directory
   */
  static async MKCOL(repositorypath, filepath, res) {
    let fullpath = Path.join(repositorypath, filepath)
    // #TODO check for existing directory and return 409 ?
    var result = await run(`mkdir -v "${fullpath}"`);
    if (result.error) {
      res.writeHead(404);
      return res.end("Error " + result.stdout + "\n" + result.stderr);
    }
    res.writeHead(200);
    res.end("created directory: " + fullpath);
  }

  static async readOptions(repositorypath, filepath, stats) {
    var fullpath = Path.join(repositorypath, filepath)
    if (!stats) {
      try {
        stats = await fs_stat(fullpath);
      } catch (e) {
        console.error("STATS error " + filepath, e)
        return JSON.stringify({ error: e }, null, 2)
      }
    }
    var result = { type: 'file' }
    result.name = filepath
    result.size = stats.size
    result.version = await this.getVersion(repositorypath, filepath)  // PERFORMANCE WARNING
    result.modified = await this.getLastModified(repositorypath, filepath) // PERFORMANCE WARNING
    return result
  }


  /*
   * list directory contents and file meta information
   */
  static async OPTIONS(repositorypath, filepath, req, res) {
    var fullpath = Path.join(repositorypath, filepath)
    logRequest(req, 'OPTIONS ' + fullpath)
    var after = req.headers['gitafter']
    var until = req.headers['gituntil']

    try {
      var stats = await fs_stat(fullpath);
    } catch (err) {
      logRequest(req, 'stat ERROR: ' + err)
      if (err.code == 'ENOENT') {
        res.writeHead(200)
        let data = JSON.stringify({ error: err }, null, 2)
        res.end(data)
      } else {
        logRequest(req, err)
      }
      return
    }
    if (stats.isDirectory()) {
      if (req.headers['showversions'] == 'true') {
        return this.listVersions(repositorypath, filepath, res, after, until);
      }

      if (req.headers['filelist'] == 'true') {
        this.readFilelist(repositorypath, filepath, res);
      } else {
        this.readDirectory(fullpath, req, res);
      }
    } else if (stats.isFile()) {
      if (req.headers['showversions'] == 'true') {
        return this.listVersions(repositorypath, filepath, res, after, until);
      }
      let data = await this.readOptions(repositorypath, filepath, stats)
      res.writeHead(200, {
        'content-type': 'text/plain' // github return text/plain, therefore we need to do the same
      });
      res.end(JSON.stringify(data, null, 2))
    }
  }

  /*
   * recursively list directories and with modification date of files
   * #Idea (should be used to update caches)
   */
  static async readFilelist(repositorypath, filepath, res) {
    var result = await run(
      `cd "${repositorypath}/${filepath}"; find -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS\t%y\t%s\t%p\n"`
    );
    var list = result.stdout
      .split('\n')
      .map(line => {
        var row = line.split('\t');
        return {
          modified: row[0],
          type: row[1] == 'd' ? 'directory' : 'file',
          size: row[2],
          name: row[3]
        };
      })
      .filter(ea => ea.name && ea.name !== '.');
    if (result.error) {
      console.error("readFilelist stderr " + result.stderr)
      console.error("readFilelist: " + result.error)
    }
    // console.log("readFilelist found " + list.length + " files")
    res.writeHead(200, {
      'content-type': 'json'
    });
    res.end(
      JSON.stringify({
        type: 'filelist',
        contents: list
      })
    );
  }

  static listVersions(repositorypath, filepath, res, after, until) {
    // #TODO rewrite artificial json formatting and for example get rit of trailing "null"
    var format =
      '\\{\\"version\\":\\"%h\\",\\"date\\":\\"%ad\\",\\"author\\":\\"%an\\"\\,\\"parents\\":\\"%p\\",\\"comment\\":\\"%f\\"},';

    // #TODO #Security #Parameters?
    var range = `${after ? '--after="' + after + '"' : ""} ${until ? '--until="' + until + '"' : ""}`

    respondWithCMD(
      `cd ${repositorypath};
      echo "{ \\"versions\\": [";
      git log --pretty=format:${format} ${range} ${filepath};
      echo null\\]}`,
      res
    );
  }

  static META(pathname, req, res) {
    if (pathname.match(/_meta\/exit/)) {
      res.end('goodbye, we hope for the best!');
      process.exit();
    } else {
      res.writeHead(500);
      res.end('meta: ' + pathname + ' not implemented!');
    }
  }

  static async getVersion(repositorypath, filepath) {
    return (await run(
      `cd "${repositorypath}"; git log -n 1 --pretty=format:%H -- "${filepath}"`
    )).stdout;
  }

  static async getLastModified(repositorypath, filepath) {
    return (await run(
      `cd "${repositorypath}"; find "${filepath}" -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS"`
    )).stdout;
  }

  static async GIT(sPath, req, res, cb) {
    logRequest(req, 'git control: ' + sPath);

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

    var repositorypath = Path.join(sourceDir, repository)

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
    if (sPath.match(/\/_git\/sync/)) {
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
        cmd = `${server}/bin/lively4sync.sh '${lively4DirUnix +
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
        await this.deleteBundleFile(repositorypath);
      } catch (error) {
        res.writeHead(500);
        res.end('Git sync failed: ' + error.message);
      } finally {
        RepositoryInSync[repository] = undefined;
      }
    } else if (sPath.match(/\/_git\/resolve/)) {
      cmd =
        `${server}/bin/lively4resolve.sh '` +
        lively4DirUnix +
        '/' +
        repository +
        "'";
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/status/)) {
      cmd = `cd ${lively4DirUnix}/${repository};
        git -c color.status=always  status ; git log --color=always HEAD...origin/${branch} --pretty="format:%h\t%aN\t%cD\t%f"`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/log/)) {
      cmd =
        'cd ' + lively4DirUnix + '/' + repository + '; git log --color=always';
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/graph/)) {
      cmd =
        'cd ' +
        lively4DirUnix +
        '/' +
        repository +
        '; git log --graph -100 --color=always';
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/commit/)) {
      if (!msg) {
        return res.end('Please provide a commit message!');
      }
      cmd =
        "cd '" +
        lively4DirUnix +
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
    } else if (sPath.match(/\/_git\/diff/)) {
      var commit = 'origin/' + branch;
      if (gitcommit) {
        commit = gitcommit + '~1 ' + gitcommit;
      }
      cmd = `cd ${lively4DirUnix}/${repository}; git diff --word-diff --color=always ${commit}`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/clone/)) {
      let url = repositoryurl.replace("https://", `https://${username}:${password}@`)
      cmd =
        `cd ${lively4DirUnix}; \n` +
        'git clone --recursive ' +
        url +
        ' ' +
        repository + `;\n` + // this will leave the password in the config
        `cd ${lively4DirUnix}/${repository}; \n` +
        // #TODO can we avoid the and prevent the storing of username and password in the first place, e.g. is there is method of handing git the usename and password without encoding them in the url?
        // remove the username password from the config       
        `git remote set-url origin ${repositoryurl}`

      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/checkout/)) {

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
      cmd = `cd ${lively4DirUnix}/${repository};\n` +
        `git remote set-url origin ${url};\n` +
        `git fetch; \n` +
        `git checkout origin/${branch} -- ${filepath}; \n` +
        `git remote set-url origin ${repositoryurl}`

      await respondWithCMD(cmd, res, dryrun);
      RepositoryInSync[repository] = undefined;
    } else if (sPath.match(/\/_git\/npminstall/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + 'npm install';
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/npmtest/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + 'npm test';
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/remoteurl/)) {
      cmd =
        `cd ${lively4DirUnix}/${repository};\n` +
        'git config --get remote.origin.url';
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/branches$/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + 'git branch -a ';
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/branch$/)) {
      cmd =
        `${server}/bin/lively4branch.sh '${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/merge$/)) {
      cmd =
        `${server}/bin/lively4merge.sh '${lively4DirUnix}/${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/squash$/)) {
      cmd =
        `${server}/bin/lively4squash.sh '${lively4DirUnix}/${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}' '${msg}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/delete$/)) {
      cmd = `${server}/bin/lively4deleterepository.sh '${lively4DirUnix}/${repository}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/show$/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + `git show ${usecolor ? " --color=always " : ""}` + gitcommit;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/reset$/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + `git reset --hard origin/${branch}`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/mergebase$/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + `git merge-base ${versionA} ${versionB} `;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/reset-hard/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + `git reset --hard origin/${branch}`;
      respondWithCMD(cmd, res, dryrun);
    } else {
      res.writeHead(200);
      res.end('Lively4 git Control! ' + sPath + ' not implemented!');
    }
  }

  static async CURL(sPath, req, res) {
    console.log("CURL url: " + req.url)
    var target = URL.parse(req.url, true).query["target"]
    if (!target || target.length == 0) {
      res.writeHead(300);
      res.end('no url parameter provided ');
      return
    }
    exec(`curl -L "${target}"`, { encoding: 'binary', maxBuffer: 1024 * 1000 * 100 }, (error, stdout, stderr) => {
      res.writeHead(200)
      res.end(stdout, "binary");
    });

  }

  static BIBTEX(sPath, req, res) {
    var query = cleanString(URL.parse(req.url, true).query["search"])
    return respondWithCMD(`${server}/bin/search-bibtex.py "${query}"`, res);
  }

  static SEARCH(sPath, req, res) {
    var pattern = req.headers['searchpattern'];
    var rootdirs = req.headers['rootdirs'];
    var excludes = '.git,' + req.headers['excludes'];

    if (sPath.match(/\/_search\/files/)) {
      var cmd = 'cd ' + lively4DirUnix + '; ';
      cmd += 'find ' + rootdirs.replace(/,/g, ' ') + ' -type f ';
      cmd += excludes
        .split(',')
        .map(function (ea) {
          return ' -not -wholename "*' + ea + '*"';
        })
        .join(' ');
      cmd +=
        ' | while read file; do grep -H "' +
        pattern +
        '" "$file" ; done | cut -b 1-200';
      return respondWithCMD(cmd, res);
    } else {
      res.writeHead(200);
      res.end('Lively4 Search! ' + sPath + ' not implemented!');
    }
  }
  /*
   * Experimental in memory tmp file for drag and drop #Hack
   */
  static TMP(pathname, req, res) {
    // log("tempFile " + pathname)
    var file = pathname.replace(/^\/_tmp\//, '');
    if (req.method == 'GET') {
      var data = this.tmpStorage[file];
      if (data) {
        res.writeHead(200);
        res.end(data, 'binary');
      } else {
        res.writeHead(404);
        res.end('file not found');
      }
    }
    if (req.method == 'PUT') {
      var fullBody = '';
      req.setEncoding('binary');
      req.on('data', chunk => {
        fullBody += chunk.toString();
      });
      req.on('end', async () => {
        this.tmpStorage[file] = fullBody;

        // Clear existing timeout if present
        if (this.tmpStorageTimeouts.has(file)) {
          clearTimeout(this.tmpStorageTimeouts.get(file));
        }

        // Set new timeout and store it
        const timeout = setTimeout(() => {
          log('cleanup ' + file);
          delete this.tmpStorage[file];
          this.tmpStorageTimeouts.delete(file);
        }, this.options['tmp-cleanup-timeout'] || 5 * 60 * 1000); // use configured timeout or default to 5min

        this.tmpStorageTimeouts.set(file, timeout);

        res.writeHead(200); // done
        res.end();
      });
    }
  }


  static GRAPHVIZ(pathname, req, res) {
    if (req.method == 'POST') {
      var fullBody = '';
      req.setEncoding('binary');
      req.on('data', chunk => {
        fullBody += chunk.toString();
      });
      req.on('end', async () => {
        var tempFile = (await run("mktemp --suffix=.dot")).stdout.replace(/\n/g, "")

        // log(`got tmp file '${tempFile}'`)
        await fs_writeFile(tempFile, fullBody)
        // log("wrote tmp file")

        var layout = "dot"
        var type = "svg"
        if (req.headers['graphlayout']) {
          layout = cleanString(req.headers['graphlayout'])
        }


        var result = (await run(`${layout} -T${type} '${tempFile}'`))
        // log(`run dot '${ tempFile}'` )

        // log("deleted temp")
        await run(`rm '${tempFile}'`)

        var source = "" + result.stdout
        if (source == "") {
          logRequest(req, "GraphViz ERR: " + result.stderr)
          res.writeHead(400); // done
          res.end(result.stderr);
        } else {
          res.writeHead(200); // done
          res.end(source);
        }
      });
    }
  }

  static MAKE(path, req, res) {
    console.log("MAKE " + path)
    var params = URL.parse(req.url, true).query
    var dir = path.replace(/.*_make\//, "")
    return respondWithCMD("cd " + lively4DirUnix + dir + "; make " + (params.target || ""), res)
  }

  static OPEN(path, req, res) {
    console.log("OPEN " + path)
    var params = URL.parse(req.url, true).query
    var relativePath = path.replace(/.*_open\//, "")
    var dir = relativePath.replace(/[^/]*$/, "")
    var file = relativePath.replace(/.*\//, "")

    return respondWithCMD("cd \"" + lively4DirUnix + dir + "\"; open \"" + file + "\"", res)
  }

  static webhookListeners(key) {
    if (!this.webhookListeners) {
      this.webhookListeners = new Map()
    }
    var set = this.webhookListeners[key]
    if (!set) {
      set = new Set()
      this.webhookListeners[key] = set
    }
    return set
  }


  /* 
    Very basic forward of github webhooks to subscriptions...
    see https://github.com/LivelyKernel/lively4-core/settings/hooks
  */
  static async WEBHOOK(pathname, req, res) {
    log("WEBHOOK " + req.method + ": " + pathname)

    if (req.method == 'GET' && pathname.match("/_webhook/register")) {
      let key = req.headers['repositoryname'];
      log("webhook register " + key)

      this.webhookListeners(key).add({
        response: res
      })
      // do not answer it... do a long poll

      // res.writeHead(200); // done
      // res.end();

    } else if ((req.method == 'PUT' || req.method == 'POST') && pathname.match("/_webhook/signal")) {

      log("webhook signal ")
      var body = '';
      req.on('data', (data) => {
        body += data;
      });
      req.on('end', () => {

        try {
          var json = JSON.parse(body)
        } catch (e) {
          res.writeHead(400); // done
          res.end("could not parse: " + body);
        }
        if (json) {
          var key = json.repository.full_name
          var listeners = this.webhookListeners(key)
          // log("found listeners: " + listeners.size)
          Array.from(listeners).forEach(ea => {
            var response = ea.response
            if (response) {
              // log("answer " + response)
              response.writeHead(200); // answer long poll 
              response.end(JSON.stringify(json));
            }
            listeners.delete(ea)
          })
          res.writeHead(200); // done
          res.end("");
        }
      });
    } else {
      log("webhook: " + pathname)
      res.writeHead(200); // not 
      res.end();
    }
  }


}

// #REFACTOR
// parse command line arguments
var args = argv.option(Server.optionsSpec).run();
Server.options = args.options
var port = args.options.port || 8080;
var sourceDir = args.options.directory || '../';
var indexFiles = args.options['index-files'];
var lively4dir = sourceDir;
var server = args.options.server || '.';
var bashBin = args.options['bash-bin'] || 'bash';
utils.config.bashBin = bashBin;
var lively4DirUnix = args.options['lively4dir-unix'] || lively4dir;
var autoCommit = args.options['auto-commit'] || false;

// Does this work?
// process.on('uncaughtException', function(error) {
//   console.log("uncaughtException: " + error)
//   process.exit(1)
// });
// process.on('unhandledRejection', function(reason, p){
//   console.log("unhandledRejection: " + reason)
// });

Server.setup();


// Only start the server if this file is being run directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = URL.fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    // Server.start();
  }
}
