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

// Third-party imports
import httpProxy from 'http-proxy';
import mime from 'mime-types';
import argv from 'argv';
import slash from 'slash'; // Convert Windows backslash paths to slash paths: foo\\bar ➔ foo/bar
import 'log-timestamp'; // this adds a timestamp to all log messages
import fetch from 'node-fetch';

import {config, cleanString, run, respondWithCMD, fs_exists, fs_readFile, fs_readdir, fs_stat, fs_writeFile, log, logRequest, try_fs_stat } from './utils.js';

import MKCOL from './services/mkcol.mjs';
import BIBTEX from './services/bibtex.mjs';
import SEARCH from './services/search.mjs';
import OPEN from './services/open.mjs';
import OPTIONS from './services/options.mjs';
import MOVE from './services/move.mjs';

import WebHookService from './services/webhook.mjs';
import GraphVizService from './services/graphviz.mjs';
import MakeService from './services/make.mjs';
import CurlService from './services/curl.mjs';
import TMPService from './services/tmp.mjs';
import METAService from './services/meta.mjs';
import GITService from './services/git.mjs';


// Cache objects
const GithubOriganizationMemberCache = {};

const RepositoryGitInUse = {}; // cheap semaphore

// Regex constants
const breakOutRegex = new RegExp('/*\\/\\.\\.\\/*/');
const isTextRegEx = /\.((txt)|(md)|(js)|(html)|(svg))$/;

import optionsSpec from './options-spec.mjs';


export class Server {
  static Config = {
    bootfilelistName: ".lively4bootfilelist",
    bundleName: ".lively4bundle.zip",
    transpileDir: ".transpiled",
    optionsDir: ".options"
  }

  static setup() {
    var args = argv.option(optionsSpec()).run();
    this.options = args.options
    this.sourceDir = args.options.directory || '../';
    this.lively4dir = this.sourceDir;
    this.serverDir = args.options.server || '.';
    this.bashBin = args.options['bash-bin'] || 'bash';
    config.bashBin = this.bashBin;
    this.lively4DirUnix = args.options['lively4dir-unix'] || this.lively4dir;
    this.autoCommit = args.options['auto-commit'] || false;
    this.port = args.options.port || 8080;
    this.tmpService = new TMPService(this);
    this.metaService = new METAService(this);
    this.gitService = new GITService(this);
  }

  static get lively4dir() {
    return this._lively4dir;
  }

  static set lively4dir(path) {
    log('set lively4dir to:' + path);
    this.sourceDir = path;
    this._lively4dir = path;
    this.lively4DirUnix = path;
    return this._lively4dir;
  }

  static start() {
    log('Welcome to Lively4!');
    log('Server: ' + this.serverDir);
    log('Lively4: ' + this.lively4dir);
    log('Port: ' + this.port);
    log('Auto-commit: ' + this.autoCommit);
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
        log('Server running on port ' + this.port + ' in directory ' + this.sourceDir);
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
    this.tmpService.cleanup();

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
          var repositorypath = Path.join(this.sourceDir, m[1]);
          var filepath = m[2]
        } else {
          repositorypath = this.sourceDir
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
          return this.tmpService.request(pathname, req, res);
        }

        if (pathname.match(/\/_meta\//)) {
          return this.metaService.request(pathname, req, res);
        }
        if (pathname.match(/\/_webhook\//)) {
          return new WebHookService(this).request(pathname, req, res);
        }
        if (path.match(/\/_git.*/)) {
          return this.gitService.request(path, req, res);
        }
        if (path.match(/\/_graphviz.*/)) {
          return new GraphVizService(this).request(path, req, res);
        }
        if (path.match(/\/_make.*/)) {
          return new MakeService(this).request(path, req, res);
        }
        if (path.match(/\/_open.*/)) {
          return new OPEN(this).request(path, req, res); // #TODO auth should be required
        }
        if (pathname.match(/\/_curl\//)) {
          return new CurlService(this).request(pathname, req, res);
        }
        if (pathname.match(/\/_search\/files/)) {
          return new SEARCH(this).request(pathname, req, res);
        }
        if (pathname.match(/\/_bibtex/)) {
          return new BIBTEX(this).request(req, res);
        }
        if (req.method == 'GET') {
          await this.GET(repositorypath, filepath, fileversion, req, res);
        } else if (req.method == 'PUT') {
          await this.PUT(repositorypath, filepath, req, res);
        } else if (req.method == 'DELETE') {
          await this.DELETE(repositorypath, filepath, res);
        } else if (req.method == 'MKCOL') {
          await new MKCOL(this).request(repositorypath, filepath, res);
        } else if (req.method == 'OPTIONS') {
          await new OPTIONS(this).request(repositorypath, filepath, req, res);
        } else if (req.method == 'MOVE') {
          await new MOVE(this).request(repositorypath, filepath, req, res);
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
    if (filepath.match(this.Config.bundleName)) {
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
      await this.ensureDirectory(repositorypath, this.Config.optionsDir)
      let optionsDir = Path.join(repositorypath, this.Config.optionsDir)

      await this.ensureDirectory(repositorypath, this.Config.transpileDir)
      let transpileDir = Path.join(repositorypath, this.Config.transpileDir)

      try {
        var bootlist = (await fs_readFile(repositorypath + "/" + this.Config.bootfilelistName)).toString()
      } catch (e) {
        logRequest(req, "WARNING, could not read " + this.Config.bootfilelistName + ":" + e)
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
          relativeOptionFiles.push(Path.join(this.Config.optionsDir, filehash))

          let transpileStats = await try_fs_stat(transpileFile)
          if (transpileStats) {
            if (stats.mtime > transpileStats.mtime) {
              logRequest(req, "DELETE " + transpileFile)
              await this.deletePath(transpileFile)
            } else {
              relativeTranspileFiles.push(Path.join(this.Config.transpileDir, filehash))
            }
          }
          let transpileMapStats = await try_fs_stat(transpileMapFile)
          if (transpileMapStats) {
            if (stats.mtime > transpileMapStats.mtime) {
              logRequest(req, "DELETE " + transpileMapFile)
              await this.deletePath(transpileMapFile)
            } else {
              relativeTranspileFiles.push(Path.join(this.Config.transpileDir, filehash + ".json.map"))

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
        if [ ! -e ${this.Config.bundleName} ]; then
          zip -r ${this.Config.bundleName} ${quoteList(relativeBootFiles)} ${quoteList(relativeOptionFiles)} ${quoteList(relativeTranspileFiles)};
        fi`
      // logRequest(req, "ZIP " + cmd)
      var result = await run(cmd)
      // logRequest(req, "stdout: " + result.stdout + "\nstderr: " + result.stderr)
    }
    return this.readFile(repositorypath, bundleFilepath, undefined, res)
  }



  static async isInBootfile(repositorypath, filepath) {
    console.log("isInBootfile " + this.Config.bootfilelistName + " in " + repositorypath + " " + filepath)
    if (filepath.match(this.Config.bootfilelistName)) {
      return true // the bootfilelist always invalidates itself...
    }

    // costs... 10ms ... so #Refactor before using it every GET requests
    var result = (await run(`cd ${repositorypath}; 
      echo ${this.Config.bootfilelistName}
      if [ -e ${this.Config.bootfilelistName} ]; then
        grep ${filepath} ${this.Config.bootfilelistName}
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
    if (filepath.match(this.Config.transpileDir) // all compiled files are bundled?
      || await this.isInBootfile(repositorypath, filepath)) {
      log("INVALIDATE " + this.Config.bundleName + " in " + repositorypath)
      // remove bundle if we uploaded a file that belongs into it
      await this.deleteBundleFile(repositorypath)
    } else {
      log("NOTINBOOTFILE " + repositorypath + " " + filepath)
    }
  }

  static async deleteBundleFile(repositorypath) {
    return await run(`cd ${repositorypath}; 
      if [ -e ${this.Config.bundleName} ]; then
        rm ${this.Config.bundleName}
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
    if (filepath.match(this.Config.transpileDir)) {
      await this.ensureDirectory(repositorypath, this.Config.transpileDir)
    }

    // if (filepath.match(this.Config.optionsDir)) { 
    //   await this.ensureDirectory(repositorypath, this.Config.optionsDir)
    // }
  }

  static async invalidateOptionsFile(repositorypath, filepath, req) {
    if (filepath.match(this.Config.optionsDir)) return  // don't do it on yourself
    if (!filepath.match(/\.js/)) return  // only javascript files are transpiled...

    logRequest(req, "invalidate options files" + this.Config.bundleName + " in " + repositorypath)
    var hashedpath = filepath.replace(/\//g, "_")
    await run(`cd ${repositorypath}; 
        if [[ -e ${this.Config.optionsDir}/${hashedpath} ]]; then
          rm ${this.Config.optionsDir}/${hashedpath}
        fi`)
  }

  static async invalidateTranspiledFile(repositorypath, filepath, req) {
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

    if (!this.autoCommit || req.headers['nocommit']) {
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
    return repositorypath + "/" + this.Config.optionsDir + "/" + filepath.replace(/\//g, "_")
  }

  static transpilePath(repositorypath, filepath) {
    return repositorypath + "/" + this.Config.transpileDir + "/" + filepath.replace(/\//g, "_")
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


}


Server.setup();


// Only start the server if this file is being run directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = URL.fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    Server.start();
  }
}
