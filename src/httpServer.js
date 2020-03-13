/*
 * # Lively4 Server -- a file server that serves and manages git repositories as REST
 *
 * ## Supported methods:
 * - GET
 * - PUT
 * - DELETE
 * - MKCOL
 * - OPTIONS
 *   - filelist
 *   - showversions
 *   - default: modified, type, name
 *
 * ## Special request HEADER
 * - fileversion
 */

import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import URL from 'url';
import Path from 'path';
import mime from 'mime';
import mkdirp from 'mkdirp';
import argv from 'argv';
import { exec } from 'child_process';
import slash from 'slash'; // Convert Windows backslash paths to slash paths: foo\\bar ➔ foo/bar
import 'log-timestamp'; // // this adds a timestamp to all log messages
import * as utils from './utils.js';
import { cleanString, run, respondWithCMD } from './utils.js';

import Promise from 'bluebird'; // seems not to workd
// e.g. this did not work var statFile = Promise.promisify(fs.stat);
// var fs_exists = Prom.promisify(fs.exists);
// but this does

import fetch from 'node-fetch';

var fs_exists = function(file) {
  return new Promise(resolve =>
    fs.exists(file, exists => {
      resolve(exists); // there seems to be an issue here, so we do it very explictly
    })
  );
};

var fs_stat = Promise.promisify(fs.stat);
async function try_fs_stat(file){
  try {
    return await fs_stat(file)
  } catch(e) {
    return null
  }
}

var fs_readdir = function(file) {
  return new Promise(resolve => fs.readdir(file, resolve));
};

var fs_writeFile = function(...args) {
  return new Promise(resolve => fs.writeFile(args[0], args[1], args[2], (err) => resolve({err: err}) ))
};

var fs_readFile = function(file) {
  return new Promise((resolve, reject) => fs.readFile(file, "utf8", (err, data) => {
    if (err) {
      reject(err)
    } else {
      resolve(data)
    }
  }))
};


fs.readFile('/etc/passwd', (err, data) => {
  if (err) throw err;
  console.log(data);
});

// var readFile = Promise.promisify(fs.readFile);
// var readDir = Promise.promisify(fs.readdir);

export function log(...args) {
  console.log('[server]', ...args);
}


// #UseCase #ContextJS #AsyncContext it is really hard to hand down the request object into all methods, just so they can log properly...
export function logRequest(req, ...args) {
  log("REQUEST[" +req._logId + "] ",...args);
}


const Lively4bootfilelistName = ".lively4bootfilelist"
const Lively4bundleName = ".lively4bundle.zip"
const Lively4transpileDir = ".transpiled"
const Lively4optionsDir = ".options"

const GithubOriganizationMemberCache = {}

var RepositoryBootfiles = {}

var RepositoryInSync = {}; // cheap semaphore

var breakOutRegex = new RegExp('/*\\/\\.\\.\\/*/');
var isTextRegEx = /\.((txt)|(md)|(js)|(html)|(svg))$/;

class Server {
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
    this.requestCounter = 0
    
    
    var proxy = httpProxy.createProxyServer({});

    http
      .createServer((req, res) => this.onRequest(req, res, proxy))
      .listen(this.port, function(err) {
        if (err) {
          throw err;
        }

        log('Server running on port ' + port + ' in directory ' + sourceDir);
      });
  }

  static setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, DELETE, PUT');
    res.setHeader('Access-Control-Allow-Headers', '*');
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

      var startRequestTime = Date.now()


      try {
        this.setCORSHeaders(res);

        // url =  new URL("https://lively-kernel.org/lively4/lively4-jens/src/client/boot.js")
        var url = URL.parse(req.url, true, false);
        var pathname = url.pathname;// /lively4/lively4-jens/src/client/boot.js

        pathname = pathname.replace(/['";&?:#|]/g, ''); // just for safty

        var path = decodeURI(slash(Path.normalize(pathname)));  // windows compat.....
        var fileversion = req.headers['fileversion']; // 

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
            logRequest(req,"CONFIG ERROR: github-organization is missing")
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
            logRequest(req,"AUTHORIZED BY CACHE")
            // do nothing
          }  else {
            logRequest(req,"AUTHORIZATION required org: " + org + " team: " + teamName)
            let teamInfo = await fetch(`https://api.github.com/orgs/${org}/teams/${teamName}`, {
              method: "GET",
              headers: {
                Authorization: "token " + password  
              }
            }).then(r => r.json());    

            if (teamInfo.members_url) {
              var members = await fetch(teamInfo.members_url.replace(/\{.*/,""), {
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

        if (pathname.match(/\/_vq\//)) {
          return this.BP2019Proxy(pathname, req, res, proxy);
        }

        if (pathname.match(/\/_github\//)) {
          req.url = req.url.replace('/_github/', '');
          return proxy.web(req, res, { target: 'http://172.16.64.132:9001/' });
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
          return this.GRAPHVIZ(path, req, res);
        }
        if (pathname.match(/\/_search\//)) {
          return this.SEARCH(pathname, req, res);
        }
        if (req.method == 'GET') {
          await  this.GET(repositorypath, filepath, fileversion, req, res);
        } else if (req.method == 'PUT') {
          await this.PUT(repositorypath, filepath, req, res);
        } else if (req.method == 'DELETE') {
          await  this.DELETE(repositorypath, filepath, res);
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
      logRequest(req, "FINISHED " + req.method + " ("+ Math.round(Date.now() - startRequestTime) + "ms) " + req.url + " " )
    }
  }

  static BP2019Proxy(pathname, req, res, proxy) {
    
    req.url = req.url.replace(/\/_vq\//, '');
    return proxy.web(req, res, { target: 'http://localhost:10055/' });
    
    // res.writeHead(200);
    //   res.end('Hey you wanted' + pathname);    
  }

  
  static GET(repositorypath, filepath, fileversion, req, res) {
    if (filepath.match(Lively4bundleName)) {
      return this.ensureBundleFile(repositorypath, filepath, req, res);
    } else if (fileversion && fileversion != 'undefined') {
      return this.readFileVersion(repositorypath, filepath, fileversion, req, res);
    } else {
      return this.readFile(repositorypath, filepath, req, res);
    }
  }
  
  static hashFilepath(filepath) {
    return filepath.replace(/\//g,"_")
  }
  
  static async ensureBundleFile(repositorypath, bundleFilepath, req, res) {
    var bundleFile = Path.join(repositorypath, bundleFilepath)
    if (!await fs_exists(bundleFile)) {
      logRequest(req,"CREATE BUNDLE for " + repositorypath)
      // #TODO pull file existence logic into javascript?
      await this.ensureDirectory(repositorypath, Lively4optionsDir)
      let optionsDir = Path.join(repositorypath, Lively4optionsDir)

      await this.ensureDirectory(repositorypath, Lively4transpileDir)
      let transpileDir = Path.join(repositorypath, Lively4transpileDir)

      try {
        var bootlist = await fs_readFile(repositorypath + "/" + Lively4bootfilelistName)
      } catch(e) {
        logRequest(req,"WARNING, could not read " + Lively4bootfilelistName + ":" + e)
      }
      var relativeBootFiles = []
      var relativeOptionFiles = []
      var relativeTranspileFiles = []

      if (bootlist) {
        var hashed = new Map()
        for(let file of bootlist.split("\n")) {

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
          if  (!optionsStats || stats.mtime > optionsStats.mtime ) {
            var updatedOptions = await this.readOptions(repositorypath, filepath, stats)
            logRequest(req, "UPDATE OPTIONS " + optionsFile)
            await fs_writeFile(optionsFile, JSON.stringify(updatedOptions, null, 2))
          }
          relativeOptionFiles.push(Path.join(Lively4optionsDir, filehash)) 

          let transpileStats = await try_fs_stat(transpileFile)
          if (transpileStats) {
            if  (stats.mtime > transpileStats.mtime ){
              logRequest(req, "DELETE " + transpileFile)
              await this.deletePath(transpileFile)
            } else {
              relativeTranspileFiles.push(Path.join(Lively4transpileDir, filehash))
            }          
          }
          let transpileMapStats = await try_fs_stat(transpileMapFile)
          if (transpileMapStats) {
            if  (stats.mtime > transpileMapStats.mtime ){
              logRequest(req, "DELETE " + transpileMapFile)
              await this.deletePath(transpileMapFile)
            } else {
              relativeTranspileFiles.push(Path.join(Lively4transpileDir, filehash  + ".json.map"))

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

      let quoteList = function(list) {
        return list.map(ea => `"${ea}"`).join(" ")
      }

      var cmd = `cd ${repositorypath}; 
        if [ ! -e ${Lively4bundleName} ]; then
          zip -r ${Lively4bundleName} ${quoteList(relativeBootFiles)} ${quoteList(relativeOptionFiles)} ${quoteList(relativeTranspileFiles)};
        fi`
      // logRequest(req, "ZIP " + cmd)
      var result = await run(cmd)
      // logRequest(req, "stdout: " + result.stdout + "\nstderr: " + result.stderr)
    }
    return this.readFile(repositorypath, bundleFilepath, undefined, res)
  }
  
  
  
  static async isInBootfile(repositorypath, filepath) {
    console.log("isInBootfile " + Lively4bootfilelistName + " in "+ repositorypath + " " + filepath)
    if (filepath.match(Lively4bootfilelistName)) {
      return true // the bootfilelist always invalidates itself...
    }
    
    // costs... 10ms ... so #Refactor before using it every GET requests
    var result = (await run(`cd ${repositorypath}; 
      echo ${Lively4bootfilelistName}
      if [ -e ${Lively4bootfilelistName} ]; then
        grep ${filepath} ${Lively4bootfilelistName}
      fi`)).stdout      
    return result.match(filepath)
  }
  
  
  /* load a specific version of a file through git */
  static readFileVersion(repositorypath, filepath, fileversion, req, res) {
    // #TODO what about the history of directory structure?
    respondWithCMD(
      'cd ' + repositorypath + ';' + 'git show ' + fileversion + ':' + filepath,
      res
    );
  }
  
  
  static async invalidateBundleFile(repositorypath, filepath) {
    if (filepath.match(Lively4transpileDir) // all compiled files are bundled?
        || await this.isInBootfile(repositorypath, filepath)) {
      log("INVALIDATE " + Lively4bundleName + " in "+ repositorypath)
      // remove bundle if we uploaded a file that belongs into it
      await this.deleteBundleFile(repositorypath)
    } else {
      log("NOTINBOOTFILE " +  repositorypath + " " + filepath)
    }
  }

  static async deleteBundleFile(repositorypath) {
    return await run(`cd ${repositorypath}; 
      if [ -e ${Lively4bundleName} ]; then
        rm ${Lively4bundleName}
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
    if (filepath.match(Lively4transpileDir)) { 
      await this.ensureDirectory(repositorypath, Lively4transpileDir)
    }
    
    // if (filepath.match(Lively4optionsDir)) { 
    //   await this.ensureDirectory(repositorypath, Lively4optionsDir)
    // }
  }

  static async invalidateOptionsFile(repositorypath, filepath, req) {
    if (filepath.match(Lively4optionsDir)) return  // don't do it on yourself
    if (!filepath.match(/\.js/)) return  // only javascript files are transpiled...
    
    logRequest(req, "invalidate options files" + Lively4bundleName + " in "+ repositorypath)
    var hashedpath = filepath.replace(/\//g,"_")
    await run(`cd ${repositorypath}; 
        if [[ -e ${Lively4optionsDir}/${hashedpath} ]]; then
          rm ${Lively4optionsDir}/${hashedpath}
        fi`)
  }
  
  static async invalidateTranspiledFile(repositorypath, filepath, req) {
    if (filepath.match(Lively4transpileDir)) return  // don't do it on yourself
    if (!filepath.match(/\.js/)) return  // only javascript files are transpiled...
    
    logRequest(req,"invalidate transpilation files" + Lively4bundleName + " in "+ repositorypath)
    var hashedpath = filepath.replace(/\//g,"_")
    var result = await run(`cd ${repositorypath}; 
        if [ -e ${Lively4transpileDir} ]; then
          rm ${Lively4transpileDir}/${hashedpath}
          rm ${Lively4transpileDir}/${hashedpath}.map.json
        fi`) 
    logRequest(req, "RESULT " + result.stdout)
  }
  
  static async readFile(repositorypath, filepath, req, res) {
    // logRequest(req, 'read based in:' + repositorypath + " file: " +filepath);
    var fullpath = Path.join(repositorypath, filepath);
    // throw new Error("hello error handler?")

    try {
      // var stats = fs.statSync(filepath)
      var stats = await fs_stat(fullpath);
    } catch(e){
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
      stream.on('error', function(err) {
        log('error reading: ' + fullpath + ' error: ' + err);
        res.end('Error reading file\n');
      });
      stream.pipe(res);
    }
  }

  static readDirectory(aPath, req, res, contentType) {
    fs.readdir(aPath, function(err, files) {
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
                .map(function(ea) {
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
      files.forEach(function(filename) {
        var filePath = Path.join(aPath, filename);
        fs.stat(filePath, function(err, statObj) {
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
    // }

    //read chunks of data and store it in buffer
    req.on('data', function(chunk) {
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
      return mkdirp(fullpath, err => {
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

    // logRequest(req, 'last version: ' + lastVersion);
    // logRequest(req, 'current version: ' + currentVersion);

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

    // ogRequest(req, 'size ' + fullBody.length);
    let result = await fs_writeFile(fullpath, fullBody, fullpath.match(isTextRegEx) ? undefined : 'binary')
    if (result.err) {
      // throw err;
      logRequest(req, result.err);
      throw new Error("Error in writeFile " + fullpath, result.err)
    }

    if (!autoCommit || req.headers['nocommit'])  {
      // logRequest(req, 'saved ' + fullpath);
      res.writeHead(200, 'OK');
      res.end();
      return
    } 

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
    {
      let {error, stdout, stderr} = await run(cmd)
      // logRequest(req, 'git stdout: ' + stdout);
      // logRequest(req, 'git stderr: ' + stderr);
      if (error) {
        // file did not change....
        if (!stdout.match("no changes added to commit")) {
          logRequest(req, 'ERROR');
          res.writeHead(500, 'Error:' + stderr);
          return res.end('ERROR stdout: ' + stdout + "\nstderr:" + stderr);
        }
      } 
    }
    var {options, body, error} = await this.ensureCachedOptions(repositorypath, filepath)
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
    console.log("ensureCachedOptions " + repositorypath + ", " + filepath )
    let options = await this.readOptions(repositorypath, filepath)
    if (options.error) {
      return {options: null, body: null, error: options.error}
    } else {
      console.log("options: " +  options )
      var optionsBody = JSON.stringify(options, null, 2)
      let optionsPath = this.optionsPath(repositorypath, filepath)
      return {options, body: optionsBody, written: fs_writeFile(optionsPath, optionsBody)}
    }
  }

  static optionsPath(repositorypath, filepath) {
    return repositorypath + "/" + Lively4optionsDir + "/" + filepath.replace(/\//g,"_") 
  }
  
  static transpilePath(repositorypath, filepath) {
    return repositorypath + "/" + Lively4transpileDir + "/" + filepath.replace(/\//g,"_") 
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
       if [ -e $SOURCE -a -e $DESTINATION ]; 
          then mv $SOURCE $DESTINATION;
       fi`)
  }
  
  static async MOVE(repositorypath, filepath, req, res) {
    
    var source = req.url
    
    var destination = req.headers['destination']
    
    var re = new RegExp(Server.options.myurl + "(.*)")    
    var m = destination.match(re)
    
    if (m) {
      destination = m[1]
    } else {
      res.writeHead(404);
      return res.end("Server for destination and source don't match!")
    }
    
    source = Server.options.directory + source.substr(1)
    destination = Server.options.directory + destination
    
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
      } catch(e) {
        console.error("STATS error " + filepath, e)
        return JSON.stringify({error: e}, null, 2)
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
    } catch(err) {
      logRequest(req, 'stat ERROR: ' + err)
      if (err.code == 'ENOENT') {
        res.writeHead(200)
        let data = JSON.stringify({error: err}, null, 2)
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
    var range = `${after ? '--after="' +after +'"': "" } ${until ? '--until="' + until +'"' : ""}`
    
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

    repository = repository.replace(/^\//,"") // #TODO should we take care of this in the client?
    
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
      cmd = `${server}/bin/lively4sync.sh '${lively4DirUnix +
        '/' +
        repository}' '${username}' '${password}' '${email}' '${branch}' '${msg}'`;
      await respondWithCMD(cmd, res, dryrun);
      RepositoryInSync[repository] = undefined;
      logRequest(req, "delete bundle: " + repositorypath)
      await this.deleteBundleFile(repositorypath)
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
      cmd = `cd ${lively4DirUnix}/${repository}; git diff --color=always ${commit}`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/clone/)) {
      let url = repositoryurl.replace("https://", `https://${username}:${password}@`)
      cmd =
        `cd ${lively4DirUnix}; \n` +
        'git clone --recursive ' +
        url +
        ' ' +
        repository +`;\n` + // this will leave the password in the config
        `cd ${lively4DirUnix}/${repository}; \n` + 
        // #TODO can we avoid the and prevent the storing of username and password in the first place, e.g. is there is method of handing git the usename and password without encoding them in the url?
        // remove the username password from the config       
        `git remote set-url origin ${repositoryurl}` 

      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/checkout/)) {
      
      logRequest(req,'CHECKOUT REPO ' + RepositoryInSync[repository] + " " + filepath);
      
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
        `git checkout origin/${branch} -- ${filepath}; \n`+
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
    } else if (sPath.match(/\/_git\/branches/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + 'git branch -a ';
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/branch/)) {
      cmd =
        `${server}/bin/lively4branch.sh '${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/merge/)) {
      cmd =
        `${server}/bin/lively4merge.sh '${lively4DirUnix}/${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/squash/)) {
      cmd =
        `${server}/bin/lively4squash.sh '${lively4DirUnix}/${repository}' ` +
        `'${username}' '${password}' '${email}' '${branch}' '${msg}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/delete/)) {
      cmd = `${server}/bin/lively4deleterepository.sh '${lively4DirUnix}/${repository}'`;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/show/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + `git show ${usecolor ? " --color=always " : ""}`  + gitcommit;
      respondWithCMD(cmd, res, dryrun);
    } else if (sPath.match(/\/_git\/reset/)) {
      cmd = `cd ${lively4DirUnix}/${repository};\n` + `git reset --hard origin/${branch}`;
      respondWithCMD(cmd, res, dryrun);
    } else {
      res.writeHead(200);
      res.end('Lively4 git Control! ' + sPath + ' not implemented!');
    }
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
        .map(function(ea) {
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
      res.writeHead(200);
      res.end(data, 'binary');
    }
    if (req.method == 'PUT') {
      var fullBody = '';
      req.setEncoding('binary');
      req.on('data', chunk => {
        fullBody += chunk.toString();
      });
      req.on('end', async () => {
        this.tmpStorage[file] = fullBody;
        setTimeout(() => {
          log('cleanup ' + file);
          delete this.tmpStorage[file];
        }, 5 * 60 * 1000); // cleanup after 5min
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
        var tempFile = (await run("mktemp --suffix=.dot")).stdout.replace(/\n/g,"") 
        
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
      let key =  req.headers['repositoryname']; 
      log("webhook register " + key)
      
      this.webhookListeners(key).add({
        response: res
      })
      // do not answer it... do a long poll
      
      // res.writeHead(200); // done
      // res.end();

    } else if((req.method == 'PUT' || req.method == 'POST') && pathname.match("/_webhook/signal")) {
   
      log("webhook signal ")
      var body = '';
      req.on('data', (data) => {
          body += data;
      });
      req.on('end', () => {

        try {
          var json = JSON.parse(body)
        } catch(e) {  
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

if (!module.parent) {
  Server.start();
}

module.exports = Server; // { start }
