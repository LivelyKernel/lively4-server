var http = require("http");
var fs = require("fs");
var url = require("url");
var path = require("path");
var mime = require("mime");
var mkdirp = require("mkdirp");
var async = require("async");
var argv = require("argv");
var child_process = require("child_process");
var slash = require("slash");


var lively4dir = "~/lively4/"; // #TODO replace magic string... lively4


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
  name: "shadow",
  short: "s",
  type: "path",
  description: "if set, reads and writes go to a shadow file system",
  example: "'node httpServer.js -s ../shadow' or 'node httpServer.js --shadow ../shadow'"
},{
  name: "index-files",
  long: "i",
  type: "boolean",
  description: "indexing files for search",
  example: "'node --index-files=true'"
}];


console.log("Welcome to Lively!");

// parse command line arguments
var args = argv.option(options).run();

var port = args.options.port || 8080;
var sSourceDir = args.options.directory || ".";
var sShadowDir = args.options.shadow;
var indexFiles = args.options['index-files'];

// use-case cof #ContextJS ?
if (indexFiles) {
 var lunrSearch = require("./lively4-search/shared/lunr-search.js");
} else {
  console.log("[search] indexing files is disabled");  
}

if (sShadowDir) {
  mkdirp(sShadowDir, function(err) {
    if (err) {
      console.log("Error creating shadow dir: " + err);
      sShadowDir = null;
    }
  });
}

if (indexFiles) {
  console.log("[search] setRootFolder " + sSourceDir)
  lunrSearch.setRootFolder(sSourceDir);
}

// this adds a timestamp to all log messages
require("log-timestamp");

var breakOutRegex = new RegExp("/*\\/\\.\\.\\/*/");

//write file to disk
function writeFile(sPath, req, res) {
  var sSourcePath = path.join(sSourceDir, sPath);
  console.log("write file: " + sSourcePath);
  var fullBody = '';

  //read chunks of data and store it in buffer
  req.on('data', function(chunk) {
    fullBody += chunk.toString();
  });

  //after transmission, write file to disk
  req.on('end', function() {
    if (sSourcePath.match(/\/$/)){
      mkdirp(sSourcePath, function(err) {
        if (err) {
          console.log("Error creating shadow dir: " + err);
        }
        console.log("mkdir " + sSourcePath);
        res.writeHead(200, "OK");
        res.end();
      });
    } else {
      fs.writeFile(sSourcePath, fullBody, function(err) {
        if (err) {
          // throw err;
          console.log(err);
          return;
        }
        
        if (indexFiles) {
          try {
            lunrSearch.addFile(sPath);
          } catch(e) {
            console.log("Error indexing file, but conitue anyway: " + e)
          }
        }
        console.log("saved " + sSourcePath);
        res.writeHead(200, "OK");
        res.end();
      });
    }
  });
}

function _readFile(sPath, res) {
  console.log("read file " + sPath);
  fs.exists(sPath, function(exists) {
    if (!exists) {
      res.writeHead(404);
      res.end("File not found!\n");
    } else {
      fs.stat(sPath, function(err, stats) {
        // console.log("stat " + sPath + " " + err + " "  + stats)
        if (err !== null) {
          if (err.code == 'ENOENT') {
              res.writeHead(404);
              res.end();
          } else {
            console.log(err);
          }
          return;
        }
        if (stats.isDirectory()) {
          readDirectory(sPath, res, "text/html");
        } else {
          res.writeHead(200, {
            'content-type': mime.lookup(sPath)
          });
          var stream = fs.createReadStream(sPath, {
            bufferSize: 64 * 1024
          });
          stream.on('error', function (err) {
            console.log("error reading: " + sPath + " error: " + err);
            res.end("Error reading file\n");
          });
          stream.pipe(res);
        }
      });
    }
  });
}

function _readShadowFile(sPath, res) {
  var sShadowPath = path.join(sShadowDir, sPath),
    sSourcePath = path.join(sSourceDir, sPath);
  fs.access(sShadowPath, fs.R_OK, function(err) {
    if (err)
      _readFile(sSourcePath, res);
    else {
      async.map([sSourcePath, sShadowPath], fs.stat, function(err, results) {
        if (err)
          console.log("Error reading file stats");
        else if (results[0].mtime > results[1].mtime)
          _readFile(sSourcePath, res);
        else {
          _readFile(sShadowPath, res);
          console.log("Loading from ShadowPath");
        }
      });
    }
  });
}

function readDirectory(aPath, res, contentType){
  fs.readdir(aPath, function(err, files) {
    var dir = {
      type: "directory",
      contents: []
    };

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
      });
    });
  });
}

var readFile = sShadowDir ? _readShadowFile : function(sPath, res) {
  return _readFile(path.join(sSourceDir, sPath), res);
};

function respondWithCMD(cmd, res, finish, dryrun) {
    console.log(cmd);

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.writeHead(200);

    if (dryrun) {
      return res.end("dry run:\n" + cmd);
    }

    var process = child_process.spawn("bash", ["-c", cmd]);

    process.stdout.on('data', function (data) {
      console.log('STDOUT: ' + data);
      res.write(data, undefined, function() {console.log("FLUSH");} );
    });

    process.stderr.on('data', function (data) {
    console.log('stderr: ' + data);
    res.write(data);
    });

    process.on('close', function (code) {
      res.end();
      if (finish) finish();
    });
}


function deleteFile(sPath, res) {
    sPath = sPath.replace(/['"; &|]/g,"");
    if (indexFiles) {
      try {
        lunrSearch.removeFile(sPath);
      } catch(e) {
        console.log("[search] Error removing file, but conitue anyway: " + e)
      }
    }
    return respondWithCMD(
      "f=~/lively4'" +sPath + "';" +
      'if [ -d "$f" ]; then rmdir -v "$f"; else rm -v "$f"; fi', res);
}

function createDirectory(sPath, res) {
  console.log("create directory " + sPath);
  sPath = sPath.replace(/['"; &|]/g,"");
  return respondWithCMD("mkdir ~/lively4'" +sPath + "'", res);
}

var RepositoryInSync = {}; // cheap semaphore

function searchFiles(sPath, req, res) {
  var pattern = req.headers["searchpattern"];
  var rootdirs = req.headers["rootdirs"];
  var excludes = ".git,"+req.headers["excludes"];

  if (sPath.match(/\/_search\/files/)) {
    var cmd = "cd " +  lively4dir + "; " 
    cmd += "find " + rootdirs.replace(/,/g," ") + " -type f " 
    cmd += excludes.split(",").map( function(ea) { return ' -not -wholename "*' + ea + '*"' }).join(" ")
    cmd += ' | while read file; do grep -H "' + pattern + '" "$file" ; done | cut -b 1-200' 
  return respondWithCMD(cmd, res)
//    return respondWithCMD("cd " +  lively4dir + "; " +
//     (rootdir ? "cd '" + rootdir + "'; " : "") + "grep -R '"+ pattern +"'", res);
  } else {
      res.writeHead(200);
      res.end("Lively4 Search! " + sPath + " not implemented!");
  }
}

function gitControl(sPath, req, res) {
  console.log("git control: " + sPath);

  var dryrun = req.headers["dryrun"];
  dryrun = dryrun && dryrun == "true";
  // #TODO replace it with something more secure... #Security #Prototype
  // Set CORS headers
  var repository =    req.headers["gitrepository"];
  var repositoryurl = req.headers["gitrepositoryurl"];
  var username =      req.headers["gitusername"];
  var password =      req.headers["gitpassword"];
  var email =         req.headers["gitemail"];
  var branch =        req.headers["gitrepositorybranch"];
  var msg =           req.headers["gitcommitmessage"];
  var filepath =      req.headers["gitfilepath"];


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
      // return repsondWithCMD("echo Sync " + repository + " " + RepositoryInSync[repository], res)
      // #TODO finish it... does not work yet
      console.log("SYNC REPO " + RepositoryInSync[repository]);
      if (RepositoryInSync[repository]) {
        return respondWithCMD("echo Sync in progress: " +
        repository, res, null, dryrun);
      }
      RepositoryInSync[repository] = true;
      cmd = "lively4sync.sh '" + repository + "' '" +
        username + "' '" + password + "' '" +email + "' '"+branch +"' '"+msg+"'";
      respondWithCMD(cmd, res, function() {
      RepositoryInSync[repository] = undefined;
      }, dryrun);

  } else if (sPath.match(/\/_git\/resolve/)) {
      cmd = "lively4resolve.sh '" + repository + "'";
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/status/)) {
      cmd = 'cd ' + repository + "; git status ";
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/log/)) {
      cmd = 'cd ' + repository + "; git log ";
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/commit/)) {
      if (msg) {
        msg = " -m'" + msg.replace(/[^A-Za-z0-9 ,.()\[\]]/g,"") +"'";
      } else {
         return res.end("Please provide a commit message!");
      }
      cmd = 'cd ' + repository + ";\n"+
        "git config user.name "+username + ";\n"+
        "git config user.email "+email + ";\n"+
        "git commit "+ msg +" -a ";
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/diff/)) {
      cmd = 'cd ' + repository + "; git diff ";
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/clone/)) {
      cmd = 'cd '+lively4dir+'; \n' +
    "git clone --recursive " + repositoryurl + " "+ repository;
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/npminstall/)) {
      cmd = 'cd ~/lively4/' +  repository + ";\n" +
    'npm install';
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/remoteurl/)) {
      cmd = 'cd ~/lively4/' +  repository + ";\n" +
    'git config --get remote.origin.url';
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/branches/)) {
      cmd = 'cd ~/lively4/' +  repository + ";\n" +
    'git branch -a ';
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/branch/)) {
     // #TODO get rud of absolute paths...
      cmd = "~/lively4-server/bin/lively4branch.sh '" + repository + "' '" +
      username + "' '" + password + "' '" +email +"' '"+ branch + "'";
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/merge/)) {
      cmd = "~/lively4-server/bin/lively4merge.sh '" + repository + "' '" +
      username + "' '" + password + "' '" +email +"' '"+ branch + "'";
      respondWithCMD(cmd, res, null, dryrun);

  } else if (sPath.match(/\/_git\/delete/)) {
      cmd = "~/lively4-server/bin/lively4deleterepository.sh '" + repository + "'";
      respondWithCMD(cmd, res, null, dryrun);

  } else {
      res.writeHead(200);
      res.end("Lively4 git Control! " + sPath + " not implemented!");
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
        console.log("[Search] index available in location: " + location);
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({indexStatus: "available"}));
      }, (err) => {
        // index not available yet
        console.log("[Search] index not yet available in location: " + location + " Error: " + err);
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({indexStatus: "indexing"}));
      });
    } catch(e) {
      console.log("[Search] could not create index, but conitue anyway: " + e)
      res.writeHead(500, {"Content-Type": "application/json"});
      res.end("Creating index failed due: " + e);
      return
    }

  } else if (sPath.match(/\/api\/search\/statusIndex.*/)) {
    lunrSearch.getStatus(location).then(status => {
      console.log(`[Search] check index status for ${location}: ${status}`);
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({indexStatus: status}));
    });
  } else if (sPath.match(/\/api\/search\/removeIndex.*/)) {
    lunrSearch.removeIndex(location).then(() => {
      console.log("[Search] index removed in location: " + location);
      res.writeHead(200, "OK");
      res.end();
    });
  } else {
    var pattern = query.q;
    console.log("[Search] search: " + pattern + " in location: " + location);
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


http.createServer(function(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Request-Method', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, DELETE, PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');

  var oUrl = url.parse(req.url, true, false);
  console.log("pathname: " + oUrl.pathname);

  var pathname = oUrl.pathname;

  // use slash to avoid conversion from '\' to '/' on Windows
  var sPath = slash(path.normalize(oUrl.pathname));
  // console.log("normalize: " + sPath);

  if (breakOutRegex.test(sPath) === true) {
    res.writeHead(500);
    res.end("Your not allowed to access files outside the pages storage area\n");
    return;
  }

  if (sPath.match(/\/_git.*/)) {
    gitControl(sPath, req, res);
    return;
  }

  if (pathname.match(/\/api\/search.*/)) {
    searchFilesWithIndex(sPath, req, res);
    return;
  }

  if (pathname.match(/\/_meta\//)) {
      if (pathname.match(/_meta\/exit/)) {
        res.end("goodbye, we hope for the best!");
        process.exit();
      } else if (pathname.match(/_meta\/hello/)) {
        res.end("Hello World!");
      } else if (pathname.match(/_meta\/play/)) {
        var filename = '~/lively4/' + req.headers["filepath"];
        var cmd = "play '" +  filename + "'";
        respondWithCMD(cmd, res);
      } else {
        res.writeHead(500);
        res.end("meta: " + pathname + " not implemented!" );
      }
      return;
  }

  if (pathname.match(/\/_search\//)) {
    searchFiles(pathname, req, res);
    return;
  }

  var sSourcePath = path.join(sSourceDir, sPath);
  if (req.method == "GET") {
    readFile(sPath, res);
  } else if (req.method == "PUT") {
    //writes go to shadow dir if selected
    if (sShadowDir) {
      var sShadowPath = path.join(sShadowDir, sPath);
      mkdirp(path.dirname(sShadowPath), function(err) {
        if (err) {
          console.log("error creating path " + sShadowPath);
        } else {
          writeFile(sShadowPath, req, res);
        }
      });
    } else {
      writeFile(sPath, req, res);
    }
  } else if (req.method == "DELETE") {
      deleteFile(sPath, res);
  } else if (req.method == "MKCOL") {
      createDirectory(sPath, res);
  } else if (req.method == "OPTIONS") {
    console.log("doing a stat on " + sSourcePath);
    // statFile was called by client
    fs.stat(sSourcePath, function(err, stats) {
      if (err !== null) {
        console.log("stat ERROR: " + err);
        if (err.code == 'ENOENT') {
            res.writeHead(404);
            res.end();
        } else {
          console.log(err);
        }
        return;
      }
      if (stats.isDirectory()) {
        readDirectory(sSourcePath, res);
      } else if (stats.isFile()) {
          if (req.headers["showversions"] == "true") {
            
            var repositorypath = sSourceDir  + sPath.replace(/^\/(.*?)\/.*/,"$1") 
            var filepath = sPath.replace(/^\/.*?\/(.*)/,"$1")
            
            respondWithCMD(
              'cd ' + repositorypath + '; echo "{ \\"versions\\": ["; ' +
              'git log --pretty=format:\\{\\"version\\":\\"%h\\",\\"date\\":\\"%ad\\",\\"author\\":\\"%an\\"\\,\\"comment\\":\\"%s\\"}, '+filepath+'; echo null\\]}', res)
              // #TODO rewrite artificial json formatting and for example get rit of trailing "null"
            return
          }

          // type, name, size
          var result = {type: "file"}
          result.name = sSourcePath.replace(/.*\//,"")
          result.size = stats.size

           
          
          // for(var i in stats) {
          //   result[i] = "" 
          // }
        
          var data = JSON.stringify(result, null, 2);
          // github return text/plain, therefore we need to do the same
          res.writeHead(200, {
            'content-type': 'text/plain'
          });
          res.end(data);
          // res.end('stat on file not implemented yet');
      }
    });
  }
}).listen(port, function(err) {
  if (err) {
    throw err;
  }
  console.log("Server running on port " + port + " in directory " + sSourceDir);
  if (sShadowDir) {
    console.log("Using shadow dir " + sShadowDir);
  }
});
