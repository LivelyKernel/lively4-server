var lunr = require("lunr");
var slash = require("slash");
var path = require("path");
var fs = require("fs");
var jsTokens = require("js-tokens");

// lunr index object
var index = null;

var idxFileName = "index.l4idx";

process.on("message", m => {
  if (!index) {
    init();
  }

  switch (m.type) {
    case "init":
      init();
      break;
    case "createIndex":
      createIndex();
      break;
    case "addFile":
      addFile(m.idxRelPath);
      break;
    case "removeFile":
      removeFile(m.idxRelPath);
      break;
    case "search":
      search(m.query);
      break;
    case "stop":
      stop();
      break;
    default:
      process.send({
        type: "error",
        message: "Unknown message type"
      });
  }
});


// *** Message handlers ***

function init() {
  if (index) {
    return;
  }

  // setup the index
  index = lunr(function() {
    this.field("filename");
    this.field("content");

    this.ref("path");
  });

  var jsTokenizer = function (obj) {
    if (!arguments.length || obj == null || obj == undefined) return []
    if (Array.isArray(obj)) return obj.map(function (t) { return lunr.utils.asString(t).toLowerCase() })

    return obj.toString().trim().toLowerCase().match(jsTokens).filter(function(token) { return token.length < 30; });
  }

  // register tokenizer function to allow index serialization
  lunr.tokenizer.registerFunction(jsTokenizer, "jsTokenizer");

  // lunr.clearStopWords();

  // set the js tokenizer
  index.tokenizer(jsTokenizer);
}

function createIndex() {
  indexFilesDeep();
  saveIndexFile();
}

function addFile(relPath) {
  addFilesToIndex([relPath]);
  saveIndexFile();
}

function removeFile(relPath) {
  removeFileFromIndex(relPath);
  saveIndexFile();
}

function search(query) {
  var result = index.search(query);

  process.send({
    type: "search-response",
    message: result
  });
}

function stop() {
  saveIndexFile();
  process.exit();
}


// *** Internal methods ***

function indexFilesDeep() {
  var relFilePaths = [];
  (function walk(rootDir) {
    fs.readdirSync(rootDir).forEach(function(file) {
      var stat = fs.statSync(path.join(rootDir, file));
      if (stat.isDirectory()) {
        walk(path.join(rootDir, file));
      } else if (stat.isFile()) {
        // just index js-files for now
        if (file.slice(-3) === ".js") {
          relFilePaths.push(path.join(rootDir, file));
        }
      }
    });
  })("./");

  addFilesToIndex(relFilePaths);
}

function addFilesToIndex(relPaths) {
  relPaths.forEach(function(_relPath, nr) {
    var relPath = slash(path.normalize(_relPath));
    var parsedPath = path.parse(relPath);
    
    // console.log("[Indexing] " + idxRelPath);
    var content = fs.readFileSync(relPath, 'utf8');

    removeFileFromIndex(relPath);

    index.add({
      path: relPath,
      filename: parsedPath.base,
      content: content
    });

    process.stdout.write("Indexing " + relPaths.length + " files (" + Math.floor((nr+1)*100 / relPaths.length) + "%)" + "\r");
    // console.log("Indexing " + relPaths.length + " files (" + Math.floor((nr+1)*100 / relPaths.length) + "%)" + "\r");
  });

  process.stdout.write("\n"); 
}

function removeFileFromIndex(_relPath) {
  var relPath = slash(path.normalize(_relPath));
  index.remove({
    path: relPath
  });
}

function saveIndexFile() {
  var serialized = JSON.stringify(index.toJSON());

  fs.writeFileSync(idxFileName, serialized);
  console.log("written index to " + path.join(process.cwd(), idxFileName));
}
