"disable livecode"
/*
 * # Lively4 Server -- a file server that serves and manages git repositories as REST
 *
 * ## Server Class
 * The Server class provides the main functionality of the Lively4 server. It handles HTTP requests, 
 * manages services, and processes file operations.
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
import express from 'express';
import expressWs from 'express-ws';

import { config, cleanString, run, respondWithCMD, fs_exists, fs_readFile, fs_readdir, fs_stat, fs_writeFile, log, logRequest, try_fs_stat } from './utils.js';

import { logDebugRequest } from './debug.js';

import MKCOL from './services/mkcol.js';
import BIBTEX from './services/bibtex.js';
import SEARCH from './services/search.js';
import OPEN from './services/open.js';
import OPTIONS from './services/options.js';
import MOVE from './services/move.js';
import DELETE from './services/delete.js';
import GET from './services/get.js';
import PUT from './services/put.js';

import AuthService from './services/auth.js';

import WebHookService from './services/webhook.js';
import GraphVizService from './services/graphviz.js';
import BundleService from './services/bundle.js';
import VersionsService from './services/versions.js';
import FilesService from './services/files.js';
import DirectoryService from './services/directory.js';

import MakeService from './services/make.js';
import CurlService from './services/curl.js';
import TMPService from './services/tmp.js';
import METAService from './services/meta.js';
import GITService from './services/git.js';
import TranspileService from './services/transpile.js';
import FileWatchService from './services/filewatch.js';


// Regex constants
const breakOutRegex = new RegExp('/*\\/\\.\\.\\/*/');
import optionsSpec from './options-spec.js';

/**
 * The main server class that handles all HTTP requests and manages services
 */
export class Server {
  /**
   * Server configuration constants
   * @type {Object}
   * @property {string} bootfilelistName - Name of the boot file list
   * @property {string} bundleName - Name of the bundle file
   * @property {string} transpileDir - Directory for transpiled files
   * @property {string} optionsDir - Directory for options
   */
  Config = {
    bootfilelistName: ".lively4bootfilelist",
    bundleName: ".lively4bundle.zip",
    transpileDir: ".transpiled",
    optionsDir: ".options"
  }

  /**
   * Initialize server configuration and services
   */
  setup() {
    var args = argv.option(optionsSpec()).run();
    this.options = args.options
    this.sourceDir = args.options.directory || '../';
    this.lively4dir = this.sourceDir;
    this.serverDir = args.options.server || '.';
    this.bashBin = args.options['bash-bin'] || 'bash';
    config.bashBin = this.bashBin;
    this.autoCommit = args.options['auto-commit'] || false;
    this.port = args.options.port || 8080;

    this.authService = new AuthService(this);
    this.tmpService = new TMPService(this);
    this.metaService = new METAService(this);
    this.gitService = new GITService(this);
    this.bundleService = new BundleService(this);
    this.versionsService = new VersionsService(this);
    this.filesService = new FilesService(this);
    this.directoryService = new DirectoryService(this);
    this.transpileService = new TranspileService(this);
    this.optionsService = new OPTIONS(this);
    this.fileWatchService = new FileWatchService(this.sourceDir);


  }

  /**
   * Get the Lively4 directory path
   * @return {string} The Lively4 directory path
   */
  get lively4dir() {
    return this._lively4dir;
  }

  /**
   * Set the Lively4 directory path
   * @param {string} path - The new Lively4 directory path
   * @return {string} The updated Lively4 directory path
   */
  set lively4dir(path) {
    log('set lively4dir to:' + path);
    this.sourceDir = path;
    this._lively4dir = path;
    return this._lively4dir;
  }

  /**
   * Start the HTTP server
   */
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

    // Create Express app with WebSocket support
    this.app = express();
    const wsInstance = expressWs(this.app);

    // WebSocket endpoint for file watching
    this.app.ws('/_filewatch', (ws, req) => {
      log('[FileWatch] WebSocket connection established');
      this.fileWatchService.addClient(ws);
    });

    // REST endpoint for file watch status
    this.app.get('/_filewatch/status', (req, res) => {
      res.json(this.fileWatchService.getStatus());
    });

    // REST endpoint for system limits
    this.app.get('/_filewatch/limits', async (req, res) => {
      const limits = await this.fileWatchService.getSystemLimits();
      res.json(limits);
    });

    // Handle all other HTTP requests
    this.app.use((req, res) => {
      this.onRequest(req, res, proxy);
    });

    this.httpServer = this.app.listen(this.port, (err) => {
      if (err) {
        throw err;
      }
      this.isRunning = true;
      log('Server running on port ' + this.port + ' in directory ' + this.sourceDir);
      log('[FileWatch] WebSocket endpoint available at /_filewatch');
      log('[FileWatch] File watching will start on-demand when clients request specific paths');
    });

    // Track new connections
    this.httpServer.on('connection', socket => {
      this.activeSockets.add(socket);
      socket.on('close', () => {
        this.activeSockets.delete(socket);
      });
    });
  }

  /**
   * Stop the HTTP server and clean up resources
   * @return {Promise} A promise that resolves when the server has stopped
   */
  async stop() {
    this.isRunning = false;
    this.tmpService.cleanup();
    this.fileWatchService.cleanup();

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

  /**
   * Set Cross-Origin Resource Sharing headers
   * @param {http.ServerResponse} res - HTTP response object
   */
  setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, DELETE, PUT, MOVE');
    res.setHeader('Access-Control-Allow-Headers', '*');
  }


  /**
   * Handle incoming HTTP requests
   * @param {http.IncomingMessage} req - HTTP request object
   * @param {http.ServerResponse} res - HTTP response object
   * @param {httpProxy} proxy - HTTP proxy instance
   */
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

        var m = path.match(/^\/([^/]*)\/(.*)/) // match /repository/path
        if (m) {
          var repositorypath = Path.join(this.sourceDir, m[1]);
          var filepath = m[2]
        } else {
          repositorypath = this.sourceDir
          filepath = path
        }

        if (!this.authService.checkAuth(req, res)) {
          return;
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

  /**
   * Main entry point when script is run directly
   */
  static main() {
    // Only start the server if this file is being run directly
    if (import.meta.url.startsWith('file:')) {
      const modulePath = URL.fileURLToPath(import.meta.url);
      if (process.argv[1] === modulePath) {
        this.start()
      }
    }
  }

  /**
   * Create and start a new server instance
   */
  static start() {
    var server = new Server();
    server.setup();
    server.start();
  }
}

Server.main();
