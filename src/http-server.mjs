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
import argv from 'argv';
import slash from 'slash'; // Convert Windows backslash paths to slash paths: foo\\bar ➔ foo/bar
import 'log-timestamp'; // this adds a timestamp to all log messages
import fetch from 'node-fetch';

import { config, cleanString, run, respondWithCMD, fs_exists, fs_readFile, fs_readdir, fs_stat, fs_writeFile, log, logRequest, try_fs_stat } from './utils.js';

import { logDebugRequest } from './debug.mjs';

import MKCOL from './services/mkcol.mjs';
import BIBTEX from './services/bibtex.mjs';
import SEARCH from './services/search.mjs';
import OPEN from './services/open.mjs';
import OPTIONS from './services/options.mjs';
import MOVE from './services/move.mjs';
import DELETE from './services/delete.mjs';
import GET from './services/get.mjs';
import PUT from './services/put.mjs';


import WebHookService from './services/webhook.mjs';
import GraphVizService from './services/graphviz.mjs';
import BundleService from './services/bundle.mjs';
import VersionsService from './services/versions.mjs';
import FilesService from './services/files.mjs';
import DirectoryService from './services/directory.mjs';

import MakeService from './services/make.mjs';
import CurlService from './services/curl.mjs';
import TMPService from './services/tmp.mjs';
import METAService from './services/meta.mjs';
import GITService from './services/git.mjs';
import TranspileService from './services/transpile.mjs';

// Cache objects
const GithubOriganizationMemberCache = {};

// Regex constants
const breakOutRegex = new RegExp('/*\\/\\.\\.\\/*/');
import optionsSpec from './options-spec.mjs';

export class Server {
  Config = {
    bootfilelistName: ".lively4bootfilelist",
    bundleName: ".lively4bundle.zip",
    transpileDir: ".transpiled",
    optionsDir: ".options"
  }

  setup() {
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
    this.bundleService = new BundleService(this);
    this.versionsService = new VersionsService(this);
    this.filesService = new FilesService(this);
    this.directoryService = new DirectoryService(this);
    this.transpileService = new TranspileService(this);
    this.optionsService = new OPTIONS(this);
  }

  get lively4dir() {
    return this._lively4dir;
  }

  set lively4dir(path) {
    log('set lively4dir to:' + path);
    this.sourceDir = path;
    this._lively4dir = path;
    this.lively4DirUnix = path;
    return this._lively4dir;
  }

  start() {
    log('Welcome to Lively4!');
    log('Server: ' + this.serverDir);
    log('Lively4: ' + this.lively4dir);
    log('Port: ' + this.port);
    log('Auto-commit: ' + this.autoCommit);
    log('Myurl: ' + this.options.myurl);

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

  async stop() {
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
  setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, DELETE, PUT, MOVE');
    res.setHeader('Access-Control-Allow-Headers', '*');
  }


  async onRequest(req, res, proxy) {
    req._logId = this.requestCounter++
    req._startTime = Date.now()


    logRequest(req, "START " + req.method + "\t" + req.url)
    try {
      logDebugRequest(req);
      var startRequestTime = Date.now()

      try {
        this.setCORSHeaders(res);

        var url = URL.parse(req.url, true, false);
        var pathname = url.pathname;

        // Validate path before any processing
        if (!this.filesService.validatePath(pathname)) {
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
          return await new GET(this).request(repositorypath, filepath, fileversion, req, res);
        }
        if (req.method == 'PUT') {
          return await new PUT(this).request(repositorypath, filepath, req, res);
        }
        if (req.method == 'DELETE') {
          return await new DELETE(this).request(repositorypath, filepath, res);
        }
        if (req.method == 'MKCOL') {
          return await new MKCOL(this).request(repositorypath, filepath, res);
        }
        if (req.method == 'OPTIONS') {
          await this.optionsService.request(repositorypath, filepath, req, res);
        }
        if (req.method == 'MOVE') {
          return await new MOVE(this).request(repositorypath, filepath, req, res);
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
}

// Only start the server if this file is being run directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = URL.fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    var server = new Server();
    server.setup();
    server.start();
  }
}
