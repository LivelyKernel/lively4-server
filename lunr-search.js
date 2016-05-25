var lunr = require("lunr");
var fs = require("fs");
var path = require("path");
var jsTokens = require("js-tokens");
var slash = require("slash");
var child_process = require("child_process");

// Object that holds workers for server subdirectories,
// e.g. '/lively4-core'
var workers = {};
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

  if (workers[subdir]) {
    // console.log("[Indexing] Overwrite existing index");
    console.log("[Indexing] Index already exists");
    return;
  }

  console.log("[Indexing] Starting new worker for " + subdir);
  try {
    workers[subdir] = child_process.fork(path.join(process.cwd(), "lunr-search-worker.js"), {
      cwd: toAbsPath(subdir),
      // pipe stdout/stderr into this process
      silent: true
    });
  } catch (err) {
    console.log("[Indexing] Error starting new worker for " + subdir + ": " + err);
    return;
  }

  // handle stdout of child
  workers[subdir].stdout.on("data", (data) => {
    process.stdout.write(`[Indexing] (${subdir}) ${data}`);
  });

  // handle stderr of child
  workers[subdir].stderr.on("data", (data) => {
    process.stderr.write(`[Indexing] (${subdir}) ${data}`);
  });

  workers[subdir].on("message", function(m) {
    switch (m.type) {
      case "search-response":
        // handle some promise stuff
        break;
      case "error":
        console.log("[Indexing] Error (" + subdir + "): " + m.message);
        break;
    }
  });

  workers[subdir].send({
    type: "createIndex"
  });
}

function search(subdir, query) {
  if (!workers[subdir]) {
    console.log("[Indexing] Cannot search, no index created for " + subdir);
    return;
  }

  workers[subdir].send({
    type: "search",
    query: query
  });

  // return promise?
}

function addFile(serverRelPath) {
  // find corresponding index
  var subdir = getIndexSubdir(serverRelPath);
  if (!subdir) {
    // no index found for the serverRelPath, so dont add it
    return;
  }
  if (!workers[subdir]) {
    console.log("[Indexing] Cannot add file, no index created for " + subdir);
    return;
  }

  var absPath = toAbsPath(serverRelPath);
  workers[subdir].send({
    type: "addFile",
    idxRelPath: toIdxRelPath(absPath)
  });
}

function removeFile(serverRelPath) {
  // find corresponding index
  var subdir = getIndexSubdir(serverRelPath);
  if (!subdir) {
    // no index found for the serverRelPath, so dont remove it
    return;
  }
  if (!workers[subdir]) {
    console.log("[Indexing] Cannot remove file, no index created for " + subdir);
    return;
  }

  var absPath = toAbsPath(serverRelPath);
  workers[subdir].send({
    type: "removeFile",
    idxRelPath: toIdxRelPath(absPath)
  });
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
