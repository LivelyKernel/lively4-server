var http = require("http");
var fs = require("fs");
var url = require("url");
var path = require("path");
var mime = require("mime");
var mkdirp = require("mkdirp");
var async = require("async");
var argv = require("argv");

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

http.createServer(function(req, res) {
  var oUrl = url.parse(req.url, true, false);
  console.log(oUrl.pathname);
  var sPath = path.normalize(oUrl.pathname);
  if (breakOutRegex.test(sPath) == true) {
    res.writeHead(500);
    res.end("Your not allowed to access files outside the pages storage area\n");
    return;
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Request-Method', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', '*');

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