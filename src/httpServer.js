/* globals require */
var http = require("http");
var fs = require("fs");
var url = require("url");
var path = require("path");
var mime = require("mime");
var mkdirp = require("mkdirp");
var argv = require("argv");
var child_process = require("child_process");
var exec = child_process.exec; 
var slash = require("slash");

var tmpStorage = {}

// this adds a timestamp to all log messages
require("log-timestamp");

// define command line options
var options = [{
  name: "port",
  short: "p",
  type: "int",
  description: "port on which the server will listen for connections",
  example: "'node httpServer.js -p 8001' or 'node httpServer.js --port=8001'"
}, {
  name: "directory",
  short: "d",
  type: "path",
  description: "root directory from which the server will serve files",
  example: "'node httpServer.js -d ../foo/bar' or node httpServer.js --directory=../foo/bar'"
}, {
  name: "server",
  type: "path",
  description: "directory where the server looks for its scripts",
  example: "'node httpServer.js --server ~/lively4-server'"
}, {
  name: "index-files",
  long: "i",
  type: "boolean",
  description: "indexing files for search",
  example: "'node --index-files=true'"
}, {
  name: "auto-commit",
  type: "boolean",
  description: "auto commit on every PUT file",
  example: "'node --auto-commit=true'"
}, {
  name: "bash-bin",
  type: "string",
  description: "path to bash executable",
  example: "'node --bash-bin=\\cygwin64\\bin\\bash.exe'"
}, {
  name: "cygwin",
  type: "boolean",
  description: "run in cygwin"
}, {
  name: "lively4dir-unix",
  type: "string",
  description: "the directory in cygwin... FUCK IT!"
}];

function log(...args) {
  console.log(...args)
}

log("Welcome to Lively4!");

// parse command line arguments
var args = argv.option(options).run();
var port = args.options.port || 8080;
var sSourceDir = args.options.directory || ".";
var indexFiles = args.options['index-files'];
var lively4dir = args.options.directory; 
var server = args.options.server || "~/lively4-server";
var bashBin = args.options['bash-bin'] || "bash";
var cygwin = args.options['cygwin'];
var lively4DirUnix = args.options['lively4dir-unix'] || lively4dir;
var autoCommit = args.options['auto-commit'] || false;
var RepositoryInSync = {}; // cheap semaphore

if (cygwin) {
  log("Lively4dir in unix: " + lively4DirUnix);
}

// use-case cof #ContextJS ?
if (indexFiles) {
 var lunrSearch = require("./lively4-search/shared/lunr-search.js");
} else {
  log("[search] indexing files is disabled");  
}

if (indexFiles) {
  log("[search] setRootFolder " + sSourceDir);
  lunrSearch.setRootFolder(sSourceDir);
}


var breakOutRegex = new RegExp("/*\\/\\.\\.\\/*/");


var isTextRegEx = /(txt)|(md)|(js)|(html)|(svg)$/

//write file to disk
function writeFile(repositorypath, filepath, req, res) {
  var fullpath = path.join(repositorypath, filepath);
  log("write file: " + fullpath);
  var fullBody = '';
  // if (filepath.match(/png$/)) {
  if (filepath.match(isTextRegEx)) {
    // #TODO how do we better decide if we need this...
  } else {
    log("set binary encoding");
    req.setEncoding('binary')
  }
  // }
  
  //read chunks of data and store it in buffer
  req.on('data', function(chunk) {
    fullBody += chunk.toString();
  });

  //after transmission, write file to disk
  req.on('end', async function() {
    if (fullpath.match(/\/$/)){
      mkdirp(fullpath, function(err) {
        if (err) {
          log("Error creating dir: " + err);
        }
        log("mkdir " + fullpath);
        res.writeHead(200, "OK");
        res.end();
      });
    } else {
      var lastVersion =  req.headers["lastversion"];
      var currentVersion = await getVersion(repositorypath, filepath)
      
      log("last version: " + lastVersion);
      log("current version: " + currentVersion);
      
      // we have version information and there is a conflict
      if (lastVersion && currentVersion && lastVersion !== currentVersion) {
        log("[writeFile] CONFLICT DETECTED")
        res.writeHead(409, { // HTTP CONFLICT
          'content-type': 'text/plain',
          'conflictversion': currentVersion
        });
        res.end("Writing conflict detected: " + currentVersion);
        return 
      } 
      
      log("size " + fullBody.length)
      
      // log("fullBody: " + fullBody)
      fs.writeFile(fullpath, fullBody, (fullpath.match(isTextRegEx) ? undefined : "binary"), function(err) {
        if (err) {
          // throw err;
          log(err);
          return;
        }
        
        if (indexFiles) {
          try {
            lunrSearch.addFile(fullpath); // #TODO #BUG what path does lunr accept?
          } catch(e) {
            log("Error indexing file, but conitue anyway: " + e);
          }
        }
        if (autoCommit) {
        
          var username =      req.headers.gitusername;
          var email =         req.headers.gitemail;
          // var password =      req.headers.gitpassword; // not used yet
        
          var authCmd = "";
          if (username) authCmd += `git config user.name '${username}'; `
          if (email) authCmd += `git config user.email '${email}'; `
          log("EMAIL " + email + " USER " + username)
          
          // #TODO maybe we should ask for github credetials here too?
          let cmd  = `cd "${repositorypath}"; ${authCmd} git add "${filepath}"; git commit -m "AUTO-COMMIT ${filepath}"`;
          log("[AUTO-COMMIT] " + cmd);
          exec(cmd, (error, stdout, stderr) => {
            log("stdout: " + stdout);
            log("stderr: " + stderr);
            if (error) {
              log("ERROR");
              res.writeHead(500, "" + err);
              res.end("ERROR: " + stderr);
            } else {
              // return the hash for the commit, we just created
              
              let fileVersionCmd = `cd "${repositorypath}"; git log -n 1 --pretty=format:%H -- "${filepath}"`;
              log("cmd: " + fileVersionCmd);
              exec(fileVersionCmd, (error, stdout, stderr) => {
                log("New version: " + stdout);
                if (error) {
                  res.writeHead(500);
                  res.end("could not retrieve new version... somthing went wrong: " + stdout + " " +stderr);
                } else {
                  res.writeHead(200, {
                    'content-type': 'text/plain',
                    'fileversion': stdout
                  });
                  res.end("Created new version: " + stdout);
                }
              });
            }
          });
        } else {
          log("saved " + fullpath);
          res.writeHead(200, "OK");
          res.end();
        }
      });
    }
  });
}

async function run(cmd) {
  return new Promise( resolve => {
    exec(cmd, (error, stdout, stderr) => {
      resolve(stdout)
    })
  })
}

async function getVersion(repositorypath, filepath) {
  return await run(`cd "${repositorypath}"; git log -n 1 --pretty=format:%H -- "${filepath}"`);
}

async function getLastModified(repositorypath, filepath) {
  return await run(`cd "${repositorypath}"; find "${filepath}" -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS"`);
}

async function readFile(repositorypath, filepath, res) {
  var sPath = repositorypath + "/" +filepath;
  log("read file: " + sPath);
  fs.exists(sPath, async function(exists) {
    if (!exists) {
      res.writeHead(404);
      res.end("File not found!\n");
    } else {
      fs.stat(sPath, async function(err, stats) {
        if (err !== null) {
          if (err.code == 'ENOENT') {
              res.writeHead(404);
              res.end();
          } else {
            log(err);
          }
          return;
        }
        if (stats.isDirectory()) {
          readDirectory(repositorypath, filepath, res, "text/html");
        } else {
          var commithash = await getVersion(repositorypath, filepath)
          var modified = await getLastModified(repositorypath, filepath)
          res.writeHead(200, {
              'content-type': mime.lookup(sPath),
              'modified': modified,
              'fileversion': commithash
          });
          var stream = fs.createReadStream(sPath, {
            bufferSize: 64 * 1024
          });
          stream.on('error', function (err) {
            log("error reading: " + sPath + " error: " + err);
            res.end("Error reading file\n");
          });
          stream.pipe(res);
           
        }
      });
    }
  });
}


/*
 * recursively directories and with modification date of files 
 * #Idea (should be used to update caches)
 */
async function readFilelist(repositorypath, filepath, res){
  var cmd = `cd "${repositorypath}"; find -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS\t%p\n"`;
  log("run: " + cmd);
  exec(cmd, async (error, stdout, stderr) => {
    var list =  stdout.split("\n").map(line => {
      var row = line.split("\t")
      return {
        modified: row[0],
        type: "file",
        name: row[1]
      }
    })
    
    res.writeHead(200, {
      'content-type': "json",
    });
    res.end(JSON.stringify({
      type: "filelist",
      contents: list
    }));
   });
}

async function readDirectory(repositorypath, filepath, res, contentType){
  var version = await getVersion(repositorypath, filepath)
  var aPath = repositorypath + "/" + filepath
  fs.readdir(aPath, async function(err, files) {
    var dir = {
      type: "directory",
      version: version,
      contents: []
    };
    
    var checkEnd = () => {
         // is there a better way for synchronization???
        if (dir.contents.length === files.length) {
          var data;
          if (contentType == "text/html") {
            // prefix the directory itself as needed if it does not end in "/"
            var match = aPath.match(/\/([^/]+)$/);
            var prefix = match ? match[1] + "/" : "";

            data = "<html><body><h1>" + aPath + "</h1>\n<ul>" +
              "<!-- prefix=" + prefix + ' -->'  +
              dir.contents.map(function(ea) {
                return "<li><a href='" + prefix + ea.name+ "'>"+ea.name + "</a></li>";
              }).join("\n") + "</ul></body></html>";

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
    }
    checkEnd()
    files.forEach(function(filename) {
      var filePath = path.join(aPath, filename);
      fs.stat(filePath, function(err, statObj) {
        if (!statObj) {
           dir.contents.push({
            type: "file",
            name: filename,
            size: 0,
          });
        } else if (statObj.isDirectory()) {
          dir.contents.push({
            type: "directory",
            name: filename,
            size: 0
          });
        } else {
          dir.contents.push({
            type: "file",
            name: filename,
            size: statObj.size
          });
        }
        checkEnd()
      });
    });
  });
}


function respondWithCMD(cmd, res, finish, dryrun) {
  log(cmd);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.writeHead(200);

  if (dryrun) {
    return res.end("dry run:\n" + cmd);
  }

  var process = child_process.spawn(bashBin, ["-c", cmd]);

  process.stdout.on('data', function (data) {
    log('STDOUT: ' + data);
    res.write(data, undefined, function() {log("FLUSH");} );
  });

  process.stderr.on('data', function (data) {
  log('stderr: ' + data);
  res.write(data);
  });

  process.on('close', function (code) {
    res.end();
    if (finish) finish();
  });
}


function deleteFile(sPath, res) {
  sPath = sPath.replace(/['";&|]/g,""); // #TODO can we get rid of stripping these?
  if (indexFiles) {
    try {
      lunrSearch.removeFile(sPath);
    } catch(e) {
      log("[search] Error removing file, but conitue anyway: " + e)
    }
  }
  return respondWithCMD(
    `f=${lively4DirUnix}/"${sPath}";
    if [ -d "$f" ]; then rmdir -v "$f"; else rm -v "$f"; fi`, res);
}

function createDirectory(sPath, res) {
  log("create directory " + sPath);
  sPath = sPath.replace(/['"; &|]/g,"");
  return respondWithCMD(`mkdir ${lively4DirUnix}/"${sPath}"`, res);
}


function listVersions(repositorypath, filepath, res) {
  // #TODO rewrite artificial json formatting and for example get rit of trailing "null"
  respondWithCMD(  'cd ' + repositorypath + '; echo "{ \\"versions\\": ["; ' +
    'git log --pretty=format:\\{\\"version\\":\\"%h\\",\\"date\\":\\"%ad\\",\\"author\\":\\"%an\\"\\,\\"comment\\":\\"%f\\"}, '+filepath+' ; echo null\\]}', res)
}

function listOptions(sSourcePath, sPath, req, res) {
  log("doing a stat on " + sSourcePath);
  // statFile was called by client
  fs.stat(sSourcePath, async function(err, stats) {
    var repositorypath = sSourceDir  + sPath.replace(/^\/(.*?)\/.*/,"$1") 
    var filepath = sPath.replace(/^\/.*?\/(.*)/,"$1")

    if (err !== null) {
      log("stat ERROR: " + err);
      if (err.code == 'ENOENT') {
          res.writeHead(404);
          res.end();
      } else {
        log(err);
      }
      return;
    }
    if (stats.isDirectory()) {
      if (req.headers["filelist"] == "true") {
        readFilelist(repositorypath, filepath, res);        
      } else {
        readDirectory(repositorypath, filepath, res);
      }
      
    } else if (stats.isFile()) {
      if (req.headers["showversions"] == "true") {
        return listVersions(repositorypath, filepath, res)
      }
            
      // type, name, size
      var result = {type: "file"}
      result.name = sSourcePath.replace(/.*\//,"")
      result.size = stats.size
      result.version = await getVersion(repositorypath, filepath)
      result.modified = await getLastModified(repositorypath, filepath)
    
      var data = JSON.stringify(result, null, 2);
      // github return text/plain, therefore we need to do the same
      res.writeHead(200, {
        'content-type': 'text/plain'
      });
      res.end(data);
    }
  });
}

function searchFiles(sPath, req, res) {
  var pattern = req.headers["searchpattern"];
  var rootdirs = req.headers["rootdirs"];
  var excludes = ".git,"+req.headers["excludes"];

  if (sPath.match(/\/_search\/files/)) {
    var cmd = "cd " +  lively4DirUnix + "; " 
    cmd += "find " + rootdirs.replace(/,/g," ") + " -type f " 
    cmd += excludes.split(",").map( function(ea) { return ' -not -wholename "*' + ea + '*"' }).join(" ")
    cmd += ' | while read file; do grep -H "' + pattern + '" "$file" ; done | cut -b 1-200' 
    return respondWithCMD(cmd, res)
  } else {
      res.writeHead(200);
      res.end("Lively4 Search! " + sPath + " not implemented!");
  }
}

function cleanString(str) {
  return str.replace(/[^A-Za-z0-9 ,.()[\]#]/g,"_")
}

function gitControl(sPath, req, res) {
  log("git control: " + sPath);

  var dryrun = req.headers["dryrun"];
  dryrun = dryrun && dryrun == "true";
  // #TODO replace it with something more secure... #Security #Prototype
  // Set CORS headers
  var repository = req.headers["gitrepository"];
  var repositoryurl = req.headers["gitrepositoryurl"];
  var username = req.headers["gitusername"];
  var password = req.headers["gitpassword"];
  var email = req.headers["gitemail"];
  var branch = req.headers["gitrepositorybranch"];
  var msg = cleanString(req.headers["gitcommitmessage"]);

  if (!email) {
    return res.end("please provide email!");
  }
  if (!username) {
    return res.end("please provide username");
  }
  if (!password) {
    return res.end("please login");
  }

  var cmd;
  if (sPath.match(/\/_git\/sync/)) {
    log("SYNC REPO " + RepositoryInSync[repository]);
    if (RepositoryInSync[repository]) {
      return respondWithCMD("echo Sync in progress: " +
      repository, res, null, dryrun);
    }
    RepositoryInSync[repository] = true;
    cmd = `${server}/bin/lively4sync.sh '${lively4DirUnix + "/"+ repository}' '${username}' '${password}' '${email}' '${branch}' '${msg}'`;
    respondWithCMD(cmd, res, function() {
    RepositoryInSync[repository] = undefined;
    }, dryrun);
    
  } else if (sPath.match(/\/_git\/resolve/)) {
    cmd = `${server}/bin/lively4resolve.sh '`+ lively4DirUnix + "/" + repository + "'";
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/status/)) {
    cmd = `cd ${lively4DirUnix}/${repository}; 
      git status; git log HEAD...origin/${branch}  --pretty="format:%h\t%aN\t%cD\t%f"`;
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/log/)) {
    cmd = 'cd ' + lively4DirUnix + "/" + repository + "; git log ";
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/graph/)) {
    cmd = 'cd ' + lively4DirUnix + "/" + repository + "; git log --graph -100";
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/commit/)) {
    if (msg) {
      msg = " -m'" + msg +"'";
    } else {
       return res.end("Please provide a commit message!");
    }
    cmd = 'cd \'' + lively4DirUnix + "/" +repository + "';\n"+
      "git config user.name "+username + ";\n"+
      "git config user.email "+email + ";\n"+
      "git commit "+ msg +" -a ";
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/diff/)) {
    cmd =  `cd ${lively4DirUnix}/${repository}; git diff origin/${branch}`;
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/clone/)) {
    cmd = `cd ${lively4DirUnix}; \n` +
      "git clone --recursive " + repositoryurl + " "+ repository;
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/npminstall/)) {
    cmd = `cd ${lively4DirUnix}/${repository};\n` +
      'npm install';
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/npmtest/)) {
    cmd = `cd ${lively4DirUnix}/${repository};\n` +
      'npm test';
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/remoteurl/)) {
    cmd = `cd ${lively4DirUnix}/${repository};\n` +
      'git config --get remote.origin.url';
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/branches/)) {
    cmd = `cd ${lively4DirUnix}/${repository};\n` +
      'git branch -a ';
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/branch/)) {
    cmd = `${server}/bin/lively4branch.sh '${repository}' `+
      `'${username}' '${password}' '${email}' '${branch}'`;
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/merge/)) {
    cmd = `${server}/bin/lively4merge.sh '${lively4DirUnix}/${repository}' `+
      `'${username}' '${password}' '${email}' '${branch}'`;;
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/squash/)) {
    cmd = `${server}/bin/lively4squash.sh '${lively4DirUnix}/${repository}' `+
      `'${username}' '${password}' '${email}' '${branch}' '${msg}'`;;
    respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/delete/)) {
    cmd = `${server}/bin/lively4deleterepository.sh '${lively4DirUnix}/${repository}'`;
    respondWithCMD(cmd, res, null, dryrun);
  } else {
    res.writeHead(200);
    res.end("Lively4 git Control! " + sPath + " not implemented!");
  }
}

/*
 * Experimental in memory tmp file for drag and drop #Hack
 */
function tempFile(pathname, req, res) {
  // log("tempFile " + pathname)
  var file = pathname.replace(/^\/_tmp\//,"")
  if (req.method == "GET") {
    var data  = tmpStorage[file] 
    res.writeHead(200);
    res.end(data, 'binary');
  }
  if (req.method == "PUT") {
    var fullBody = '';  
    req.setEncoding('binary')
    req.on('data', function(chunk) {
      fullBody += chunk.toString();
    });
    req.on('end', async function() {
      tmpStorage[file] = fullBody
      setTimeout(() => {
        log("cleanup " + file)
        delete tmpStorage[file]
      }, 5 * 60 * 1000) // cleanup after 5min
      res.writeHead(200); // done
      res.end();
    })
  }
}

function metaControl(pathname, req, res) {
  if (pathname.match(/_meta\/exit/)) {
    res.end("goodbye, we hope for the best!");
    process.exit();
  } else if (pathname.match(/_meta\/play/)) {
    var filename = lively4DirUnix + "/" + req.headers["filepath"];
    var cmd = "play '" +  filename + "'";
    respondWithCMD(cmd, res);
  } else {
    res.writeHead(500);
    res.end("meta: " + pathname + " not implemented!" );
  }
}

function searchFilesWithIndex(sPath, req, res) {
  if (!indexFiles) {
      res.writeHead(503);
      return res.end("Index server not running ");
  }
  var urlParts = url.parse(req.url, true);
  var query = urlParts.query;
  var location = query.location;

  if (sPath.match(/\/api\/search\/createIndex.*/)) {
    
    try {
      lunrSearch.createIndex(location).then(() => {
        // index is available
        log("[Search] index available in location: " + location);
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({indexStatus: "available"}));
      }, (err) => {
        // index not available yet
        log("[Search] index not yet available in location: " + location + " Error: " + err);
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({indexStatus: "indexing"}));
      });
    } catch(e) {
      log("[Search] could not create index, but conitue anyway: " + e)
      res.writeHead(500, {"Content-Type": "application/json"});
      res.end("Creating index failed due: " + e);
      return
    }

  } else if (sPath.match(/\/api\/search\/statusIndex.*/)) {
    lunrSearch.getStatus(location).then(status => {
      log(`[Search] check index status for ${location}: ${status}`);
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({indexStatus: status}));
    });
  } else if (sPath.match(/\/api\/search\/removeIndex.*/)) {
    lunrSearch.removeIndex(location).then(() => {
      log("[Search] index removed in location: " + location);
      res.writeHead(200, "OK");
      res.end();
    });
  } else {
    var pattern = query.q;
    log("[Search] search: " + pattern + " in location: " + location);
    lunrSearch.search(location, pattern).then((results) => {
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify(results));
    }).catch(err => {
      // no index for location available
      res.writeHead(503);
      res.end();
    });
  }
}

/* load a specific version of a file through git */
function readFileVersion(repositorypath, filepath, fileversion, res) {
  respondWithCMD(
    'cd ' + repositorypath + ';' +
    'git show '+fileversion +':' + filepath, res)
}

class Server {

  static setup() {
    this.port = port
    this.server = server
  }
  
  static get lively4dir() {
    return lively4dir
  }
  
  static set lively4dir(path) {
    log("set lively4dir to:" + path)
    sSourceDir = path;
    lively4dir = path;
    lively4DirUnix = path;
    return lively4dir
  }
  
  static get autoCommit() {
    return autoCommit
  }
  
  static set autoCommit(bool) {
    log("set autoCommit to: " + bool)
    return autoCommit = bool
  }

  static start() {
    log("Server: "+ this.server);
    log("Lively4: "+ lively4dir);
    log("Port: "+ this.port);
    log("Indexing: "+ indexFiles);
    log("Auto-commit: "+ autoCommit);
    http.createServer((req,res) => this.onRequest(req,res)).listen(this.port, function(err) {
      if (err) {
        throw err;
      }
      log("Server running on port " + port + " in directory " + sSourceDir);
    });
  }
  
  static onRequest(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, DELETE, PUT');
    res.setHeader('Access-Control-Allow-Headers', '*');

    var oUrl = url.parse(req.url, true, false);
    log("pathname: " + oUrl.pathname);
    var pathname = oUrl.pathname;
    
    // use slash to avoid conversion from '\' to '/' on Windows
    var sPath = decodeURI(slash(path.normalize(oUrl.pathname)));
    log("sPath: " + sPath)

    var fileversion =  req.headers["fileversion"]
    log("fileversion: " + fileversion)
    var repositorypath = sSourceDir  + sPath.replace(/^\/(.*?)\/.*/,"$1") 
    var filepath = sPath.replace(/^\/.*?\/(.*)/,"$1")

    if (breakOutRegex.test(sPath) === true) {
      res.writeHead(500);
      res.end("Your not allowed to access files outside the pages storage area\n");
      return;
    }
    if (pathname.match(/\/_tmp\//)) {
      return tempFile(pathname, req, res)
    }
    if (pathname.match(/\/_meta\//)) {
      return metaControl(pathname, req, res)
    }
    if (sPath.match(/\/_git.*/)) {
      return gitControl(sPath, req, res);
    }
    if (pathname.match(/\/api\/search.*/)) {
      return searchFilesWithIndex(sPath, req, res);
    }
    if (pathname.match(/\/_search\//)) {
      return searchFiles(pathname, req, res);
    }
    var sSourcePath = path.join(sSourceDir, sPath);
    if (req.method == "GET") {
      if (fileversion && fileversion != "undefined") {
        readFileVersion(repositorypath, filepath, fileversion, res)
      } else {
        readFile(repositorypath, filepath, res);
      }
    } else if (req.method == "PUT") {
      writeFile(repositorypath, filepath, req, res);
    } else if (req.method == "DELETE") {
      deleteFile(sPath, res);
    } else if (req.method == "MKCOL") {
      createDirectory(sPath, res);
    } else if (req.method == "OPTIONS") {
      listOptions(sSourcePath, sPath, req, res)
    }
  }
}
Server.setup()

if (!module.parent) {
  Server.start()
}
module.exports = Server // { start }
