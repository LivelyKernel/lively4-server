var lunr = require("lunr");
var fs = require("fs");
var path = require("path");
var jsTokens = require("js-tokens");
var slash = require("slash");

// Object that holds indexes for server subdirectories,
// e.g. '/lively4-core'
var lunrIdx = {};
// rootFolder is an absolute directory to where the server serves,
// e.g. where the lively4-core folder is found
var rootFolder = null;
var idxFileName = "index.l4idx";


// *** Exported methods ***

function setRootFolder(filepath) {
  // becomes e.g. "C:/felix/bla" on Windows
  rootFolder = slash(path.resolve(filepath));
}

function createIndex(subdir) {
  if (!rootFolder) {
    console.log("[Indexing] Cannot create index, no root folder set");
    return;
  }

  if (lunrIdx[subdir]) {
    console.log("[Indexing] Overwrite existing index");
  }

  lunrIdx[subdir] = lunr(function() {
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

  // js tokenizer
  lunrIdx[subdir].tokenizer(jsTokenizer);

  indexFilesDeep(subdir);
  saveIndexFile(subdir);
}

function search(subdir, query) {
  if (!lunrIdx[subdir]) {
    console.log("[Indexing] Cannot search, no index created for " + subdir);
    return;
  }

  return lunrIdx[subdir].search(query);
}

function addFile(serverRelPath) {
  // find corresponding index
  var subdir = getIndexSubdir(serverRelPath);
  if (!subdir) {
    // no index found for the serverRelPath, so dont add it
    return;
  }

  var absPath = toAbsPath(serverRelPath);
  addFilesToIndex(subdir, [absPath]);
}

function removeFile(serverRelPath) {
  // find corresponding index
  var subdir = getIndexSubdir(serverRelPath);
  if (!subdir) {
    // no index found for the serverRelPath, so dont remove it
    return;
  }
  if (!lunrIdx[subdir]) {
    console.log("[Indexing] Cannot remove file, no index created for " + subdir);
    return;
  }

  var idxRelPath = toIdxRelPath(subdir, serverRelPath);
  lunrIdx[subdir].remove({
    path: idxRelPath
  });
  console.log("[Indexing] removed " + idxRelPath);
}


// *** Internal methods ***

function indexFilesDeep(subdir) {
  var absFilePaths = [];
  (function walk(rootDir) {
    fs.readdirSync(rootDir).forEach(function(file) {
      var stat = fs.statSync(path.join(rootDir, file));
      if (stat.isDirectory()) {
        walk(path.join(rootDir, file));
      } else if (stat.isFile()) {
        // just index js-files for now
        if (file.slice(-3) === ".js") {
          absFilePaths.push(path.join(rootDir, file));
        }
      }
    });
  })(toAbsPath(subdir));

  return addFilesToIndex(subdir, absFilePaths);
}

function addFilesToIndex(subdir, absPaths) {
  if (!lunrIdx[subdir]) {
    console.log("[Indexing] Cannot add files, no index found for " + subdir);
    return;
  }

  absPaths.forEach(function(absPath, nr) {
    var idxRelPath = toIdxRelPath(subdir, absPath);
    var parsedPath = path.parse(absPath);

    currentFileNr = nr;
    
    // console.log("[Indexing] " + idxRelPath);
    var content = fs.readFileSync(absPath, 'utf8');

    lunrIdx[subdir].remove({
      path: idxRelPath
    });

    lunrIdx[subdir].add({
      path: idxRelPath,
      filename: parsedPath.base,
      content: content
    });

    process.stdout.write("[Indexing] Indexing " + absPaths.length + " files (" + Math.floor((nr+1)*100 / absPaths.length) + "%)" + "\r");
  });

  process.stdout.write("\n");    
}

function saveIndexFile(subdir) {
  if (!lunrIdx[subdir]) {
    console.log("[Indexing] Cannot save index, no index created");
    return;
  }
  var serialized = JSON.stringify(lunrIdx[subdir].toJSON());
  var idxFilePath = path.join(toAbsPath(subdir), idxFileName);

  fs.writeFileSync(idxFilePath, serialized);
  console.log("written index to " + idxFilePath);
}


// *** Helper methods ***

function getIndexSubdir(filepath) {
  return Object.keys(lunrIdx).find(function(subidx) {
    return filepath.indexOf(subidx + "/") == 0;
  });
}

function toAbsPath(serverRelPath) {
  return slash(path.join(rootFolder, serverRelPath));
}

function toIdxRelPath(subdir, absPath) {
  if (!rootFolder) {
    return;
  }

  // TODO: dont use length to cut off paths
  return slash(absPath.slice(rootFolder.length + subdir.length));
}


// *** Export public methods ***

module.exports = {
  setRootFolder: setRootFolder,
  createIndex: createIndex,
  search: search,
  add: addFile,
  remove: removeFile
}
