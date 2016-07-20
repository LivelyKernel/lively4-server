var http = require("http");
var fs = require("fs");
var url = require("url");
var path = require("path");
var mime = require("mime");
var mkdirp = require("mkdirp");
var async = require("async");
var argv = require("argv");
var child_process = require("child_process")
var slash = require("slash");
var lunrSearch = require("./lunr-search.js");
// .search(string)
// .update(path)
// .add(path)
// .remove(path)


var lively4dir = "~/lively4/" // #TODO replace magic string... lively4


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
}]

console.log("Welcome to Lively!")

// parse command line arguments
var args = argv.option(options).run();

var port = args.options.port || 8080;
var sSourceDir = args.options.directory || ".";
var sShadowDir = args.options.shadow;

if (sShadowDir) {
  mkdirp(sShadowDir, function(err) {
    if (err) {
      console.log("Error creating shadow dir: " + err);
      sShadowDir = null;
    }
  });
}

lunrSearch.setRootFolder(sSourceDir);
// lunrSearch.createIndex("/lively4-core");

// this adds a timestamp to all log messages
require("log-timestamp");

var breakOutRegex = new RegExp("/*\\/\\.\\.\\/*/");

//write file to disk
function writeFile(sPath, req, res) {
  var sSourcePath = path.join(sSourceDir, sPath);
  console.log("write file: " + sSourcePath)
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
        lunrSearch.addFile(sPath);
        console.log("saved " + sSourcePath);
        res.writeHead(200, "OK");
        res.end();
      });
    }
  });
}

function _readFile(sPath, res) {
  console.log("read file " + sPath)
  fs.exists(sPath, function(exists) {
    if (!exists) {
      res.writeHead(404);
      res.end("File not found!\n");
    } else {
      fs.stat(sPath, function(err, stats) {
        // console.log("stat " + sPath + " " + err + " "  + stats)
        if (err != null) {
          if (err.code == 'ENOENT') {
              res.writeHead(404);
              res.end();
          } else {
            console.log(err);
          }
          return;
        }
        if (stats.isDirectory()) {
          readDirectory(sPath, res, "text/html")
        } else {
          res.writeHead(200, {
            'content-type': mime.lookup(sPath)
          });
          var stream = fs.createReadStream(sPath, {
            bufferSize: 64 * 1024
          });
          stream.on('error', function (err) {
            console.log("error reading: " + sPath + " error: " + err)
            res.end("Error reading file\n");
          });
          stream.pipe(res);
        }
      });
    };
  })
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
    }

    files.forEach(function(filename) {
      var filePath = path.join(aPath, filename)
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
          if (contentType == "text/html") {
            // prefix the directory itself as needed if it does not end in "/"
            var prefix;
            var match = aPath.match(/\/([^/]+)$/);
            var prefix = match ? match[1] + "/" : "";

            var data = "<html><body><h1>" + aPath + "</h1>\n<ul>" +
              "<!-- prefix=" + prefix + ' -->'  +
              dir.contents.map(function(ea) {
                return "<li><a href='" + prefix + ea.name+ "'>"+ea.name + "</a></li>"
              }).join("\n") + "</ul></body></html>"
            // github return text/plain, therefore we need to do the same
            res.writeHead(200, {
              'content-type': 'text/html'
            });
            res.end(data);
          } else {
            var data = JSON.stringify(dir, null, 2);
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
  return _readFile(path.join(sSourceDir, sPath), res)
};

function respondWithCMD(cmd, res, finish, dryrun) {
    console.log(cmd)

    res.setHeader('Content-Type', 'text/plain')
    res.setHeader('Transfer-Encoding', 'chunked')
    res.writeHead(200);

    if (dryrun) {
      return res.end("dry run:\n" + cmd)
    }

    var process = child_process.spawn("bash", ["-c", cmd]);

    process.stdout.on('data', function (data) {
      console.log('STDOUT: ' + data);
      res.write(data, undefined, function() {console.log("FLUSH")} )
    })

    process.stderr.on('data', function (data) {
    console.log('stderr: ' + data);
    res.write(data)
    })

    process.on('close', function (code) {
      res.end()
      if (finish) finish()
    })
}


function deleteFile(sPath, res) {
    sPath = sPath.replace(/['"; &|]/g,"")
    lunrSearch.removeFile(sPath);
    return respondWithCMD("rm -v ~/lively4'" +sPath + "'", res)
}

var RepositoryInSync = {} // cheap semaphore


function searchFiles(sPath, req, res) {
  var pattern = req.headers["searchpattern"]
  var rootdir = req.headers["rootdir"]

  if (sPath.match(/\/_search\/files/)) {
    return respondWithCMD("cd " +  lively4dir + "; " +
    (rootdir ? "cd '" + rootdir + "'; " : "") +
    "grep -R '"+ pattern +"'", res)
  } else {
      res.writeHead(200);
      res.end("Lively4 Search! " + sPath + " not implemented!");
  }
}

function gitControl(sPath, req, res) {
  console.log("git control: " + sPath)

  var dryrun = req.headers["dryrun"]
  dryrun = dryrun && dryrun == "true"
  // #TODO replace it with something more secure... #Security #Prototype
  // Set CORS headers
  var repository = req.headers["gitrepository"]
  var repositoryurl = req.headers["gitrepositoryurl"]
  var username = req.headers["gitusername"]
  var password = req.headers["gitpassword"]
  var email = req.headers["gitemail"]
  var branch = req.headers["gitrepositorybranch"]
  var msg = req.headers["gitcommitmessage"]

  if (!email) {
    return res.end("please provide email")
  }
  if (!username) {
    return res.end("please provide username")
  }
  if (!password) {
    return res.end("please login")
  }

  if (sPath.match(/\/_git\/sync/)) {
      // return repsondWithCMD("echo Sync " + repository + " " + RepositoryInSync[repository], res)
      // #TODO finish it... does not work yet
      console.log("SYNC REPO " + RepositoryInSync[repository])
      if (RepositoryInSync[repository]) {
        return respondWithCMD("echo Sync in progress: " +
        repository, res, null, dryrun)
      }
      RepositoryInSync[repository] = true
      var cmd = "lively4sync.sh '" + repository + "' '"
        + username + "' '" + password + "' '" +email + "' '"+branch +"' '"+msg+"'"
      respondWithCMD(cmd, res, function() {
      RepositoryInSync[repository] = undefined
      }, dryrun)

  } else if (sPath.match(/\/_git\/resolve/)) {
      var cmd = "lively4resolve.sh '" + repository + "'"
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/status/)) {
      var cmd = 'cd ' + repository + "; git status "
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/log/)) {
      var cmd = 'cd ' + repository + "; git log "
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/commit/)) {
      if (msg) {
        msg = " -m'" + msg.replace(/[^A-Za-z0-9 ,.()\[\]]/g,"") +"'"
      } else {
         return res.end("Please provide a commit message!")
      }
      var cmd = 'cd ' + repository + ";\n"+
        "git config user.name "+username + ";\n"+
        "git config user.email "+email + ";\n"+
        "git commit "+ msg +" -a "
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/diff/)) {
      var cmd = 'cd ' + repository + "; git diff "
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/clone/)) {
      var cmd = 'cd '+lively4dir+'; \n' +
    "git clone " + repositoryurl + " "+ repository
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/npminstall/)) {
      var cmd = 'cd ~/lively4/' +  repository + ";\n" +
    'npm install'
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/remoteurl/)) {
      var cmd = 'cd ~/lively4/' +  repository + ";\n" +
    'git config --get remote.origin.url'
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/branches/)) {
      var cmd = 'cd ~/lively4/' +  repository + ";\n" +
    'git branch -a '
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/branch/)) {
      var cmd = "~/lively4-server/bin/lively4branch.sh '" + repository + "' '"
    + username + "' '" + password + "' '" +email +"' '"+ branch + "'"
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/merge/)) {
      var cmd = "~/lively4-server/bin/lively4merge.sh '" + repository + "' '"
    + username + "' '" + password + "' '" +email +"' '"+ branch + "'"
      respondWithCMD(cmd, res, null, dryrun)

  } else if (sPath.match(/\/_git\/delete/)) {
      var cmd = "~/lively4-server/bin/lively4deleterepository.sh '" + repository + "'"
      respondWithCMD(cmd, res, null, dryrun)

  } else {
      res.writeHead(200);
      res.end("Lively4 git Control! " + sPath + " not implemented!");
  }
}


function searchFilesWithIndex(sPath, req, res) {
  var urlParts = url.parse(req.url, true);
  var query = urlParts.query;
  var location = query.location;

  if (sPath.match(/\/api\/searchSetup.*/)) {
    lunrSearch.createIndex(location).then(() => {
      // index is available
      console.log("[Search] index available in location: " + location);
      res.writeHead(200, "OK");
      res.end();
    }, () => {
      // index not available yet
      console.log("[Search] index not yet available in location: " + location);
      res.writeHead(200, "Not yet");
      res.end();
    });
  } else if (sPath.match(/\/api\/searchIndexStatus.*/)) {
    lunrSearch.getStatus(location).then(status => {
      console.log(`[Search] check index status for ${location}: ${status}`);
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({indexStatus: status}));
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
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', '*');

  var oUrl = url.parse(req.url, true, false);
  console.log("pathname: " + oUrl.pathname);

  var pathname = oUrl.pathname

  // use slash to avoid conversion from '\' to '/' on Windows
  var sPath = slash(path.normalize(oUrl.pathname));
  // console.log("normalize: " + sPath);

  if (breakOutRegex.test(sPath) == true) {
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
        res.end("goodbye, we hope for the best!")
        process.exit()
      } else if (pathname.match(/_meta\/hello/)) {
        res.end("Hello World!")
      } else if (pathname.match(/_meta\/play/)) {
        var filename = '~/lively4/' +req.headers["filepath"]
        var cmd = "play '" +  filename + "'"
        respondWithCMD(cmd, res)
      } else {
        res.writeHead(500);
        res.end("meta: " + pathname + " not implemented!" );
      }
      return
  }

  if (pathname.match(/\/_search\//)) {
    searchFiles(pathname, req, res)
    return
  }

  var sSourcePath = path.join(sSourceDir, sPath);
  if (req.method == "GET") {
    readFile(sPath, res)
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
      deleteFile(sPath, res)
  } else if (req.method == "OPTIONS") {
    console.log("doing a stat on " + sSourcePath);
    // statFile was called by client
    fs.stat(sSourcePath, function(err, stats) {
      if (err != null) {
        console.log("stat ERROR: " + err)
        if (err.code == 'ENOENT') {
            res.writeHead(404);
            res.end();
        } else {
          console.log(err);
        }
        return;
      }
      if (stats.isDirectory()) {
        readDirectory(sSourcePath, res)
      } else if (stats.isFile()) {
          res.writeHead(200, {
            'content-type': 'text/plain'
          });
          res.end('stat on file not implemented yet');
      }
    });
  }
}).listen(port, function(err) {
  if (err) {
    throw err;
  }
  console.log("Server running on port " + port + " in directory " + sSourceDir);
  if (sShadowDir) {
    console.log("Using shadow dir " + sShadowDir)
  }
});
