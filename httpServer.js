var http = require("http");
var fs = require("fs");
var url = require("url");
var path = require("path");
var mime = require("mime");
var mkdirp = require("mkdirp");
var async = require("async");
var argv = require("argv");
var child_process = require("child_process")



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
  name: "shadow",
  short: "s",
  type: "path",
  description: "if set, reads and writes go to a shadow file system",
  example: "'node httpServer.js -s ../shadow' or 'node httpServer.js --shadow ../shadow'"
}]

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

var breakOutRegex = new RegExp("/*\\/\\.\\.\\/*/");

//write file to disk
function writeFile(sPath, req, res) {
  var fullBody = '';

  //read chunks of data and store it in buffer
  req.on('data', function(chunk) {
    fullBody += chunk.toString();
  });

  //after transmission, write file to disk
  req.on('end', function() {
    fs.writeFile(sPath, fullBody, function(err) {
      if (err) {
        // throw err;
        console.log(err);
        return;
      }
      console.log("saved " + sPath);
      res.writeHead(200, "OK");
      res.end();
    });
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
			// res.writeHead(200, {
	  //       	'content-type': 'text/html'
	  //     	});
	  //     	res.end("This is a directory")
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
	  }) 
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
      fs.stat(path.join(aPath, filename), function(err, statObj) {
        if (statObj.isDirectory()) {
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
        	  var match = aPath.match(/\/([^/]+)$/)
        	  if (match) { prefix = match[1] + "/" } else {prefix = ""};

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

function repsondWithCMD(cmd, res) {
    var process = child_process.spawn("bash", ["-c", cmd]);
    res.writeHead(200);

    process.stdout.on('data', function (data) {
	console.log('STDOUT: ' + data);
	res.write(data, undefined, function() {console.log("flush")} )
    })

    process.stderr.on('data', function (data) {
	console.log('stderr: ' + data);
	res.write(data)
    })

    process.on('close', function (code) {
	res.end()
    })


    // child_process.exec(cmd,
    // 	function (error, stdout, stderr) {
    // 	    console.log('stdout: ' + stdout);
    // 	    console.log('stderr: ' + stderr);
    // 	    if (error !== null) {
    // 		console.log('exec error: ' + error); 
   // 		res.writeHead(500);
    // 		res.end("" + stdout + "\n\nSTDERR: " + stderr);
    // 	    } else {
    // 		res.writeHead(200);
    // 		res.end("" + stdout );
    // 	    }
    // 	});
}


function gitControl(sPath, req, res) {
  console.log("git control: " + sPath)
  if (sPath.match(/\/_git\/sync/)) {
      // #TODO replace it with something more secure... #Security #Prototype
  // Set CORS headers
      var repository = req.headers["gitrepository"]
      var username = req.headers["gitusername"]
      var password = req.headers["gitpassword"]
      var email = req.headers["gitemail"]


      var cmd = "~/lively4-server/bin/lively4sync.sh '" + repository + "' '" + username + "' '" + password + "' '" +email +"'"
      console.log(cmd)
      repsondWithCMD(cmd, res)
  } else if (sPath.match(/\/_git\/status/)) {
      var repository = req.headers["gitrepository"]
      var cmd = 'cd ' + repository + "; git status "
      console.log(cmd)
      repsondWithCMD(cmd, res)
  } else if (sPath.match(/\/_git\/diff/)) {
      var repository = req.headers["gitrepository"]
      var cmd = 'cd ' + repository + "; git diff "
      console.log(cmd)
      repsondWithCMD(cmd, res)
  } else if (sPath.match(/\/_git\/clone/)) {
      var repositoryurl = req.headers["gitrepositoryurl"]
      var repository = req.headers["gitrepository"]

      var cmd = 'echo cd ~/lively4/' + 
	  "; echo git clone " + repositoryurl + " "+ repository 
      console.log(cmd)
      repsondWithCMD(cmd, res)
  } else {
      res.writeHead(200);
      res.end("Lively4 git Control! " + sPath + " not implemented!");
  }
}


http.createServer(function(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Request-Method', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', '*');


  var oUrl = url.parse(req.url, true, false);
  console.log(oUrl.pathname);
  var sPath = path.normalize(oUrl.pathname);
  if (breakOutRegex.test(sPath) == true) {
    res.writeHead(500);
    res.end("Your not allowed to access files outside the pages storage area\n");
    return;
  }

    if (sPath.match(/\/_git.*/)) {
	gitControl(sPath, req, res)
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
      writeFile(sSourcePath, req, res);
    }
  } else if (req.method == "OPTIONS") {
    console.log("doing a stat on " + sSourcePath);
    // statFile was called by client
    fs.stat(sSourcePath, function(err, stats) {
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