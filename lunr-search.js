var path = require("path");
var slash = require("slash");
var child_process = require("child_process");

// Object that holds workers for server subdirectories,
// e.g. '/lively4-core'
var workers = {};

var promiseCallbacks = {};
// rootFolder is an absolute directory to where the server serves,
// e.g. where the lively4-core folder is found
var rootFolder = null;
var idxFileName = "index.l4idx";

var curMsgId = 0;


// *** Exported methods ***

function setRootFolder(filepath) {
  // becomes e.g. "C:/felix/bla" on Windows
  rootFolder = slash(path.resolve(filepath));
}

function createIndex(subdir) {
  return new Promise((resolve, reject) => {
    if (!rootFolder) {
      console.log("[Indexing] Cannot create index, no root folder set");
      reject("Error: no root folder set");
      return;
    }

    if (workers[subdir]) {
      console.log("[Indexing] Index already exists");
      resolve();
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
          handleSearchResponse(m.msgId, m.message);
          break;
        case "init-response":
          handleInitResponse(m.msgId, m.message);
          break;
        case "error":
          console.log("[Indexing] Error (" + subdir + "): " + m.message);
          break;
      }
    });

    var msgId = getNextMsgId();
    promiseCallbacks[msgId] = {
      resolve: resolve,
      reject: reject
    }

    workers[subdir].send({
      type: "init",
      msgId: msgId
    });
  });
}

function search(subdir, query) {
  if (!workers[subdir]) {
    console.log("[Indexing] Cannot search, no index created for " + subdir);
    return;
  }

  var msgId = getNextMsgId();
  promiseCallbacks[msgId] = {};

  var p = new Promise((resolve, reject) => {
    promiseCallbacks[msgId].resolve = resolve;
    promiseCallbacks[msgId].reject = reject;
  });

  workers[subdir].send({
    type: "search",
    msgId: msgId,
    query: query
  });

  return p;
}

function handleSearchResponse(msgId, result) {
  if (!promiseCallbacks[msgId]) {
    console.log(`[Indexing] No promise registered for ${msgId}`);
    return;
  }

  var resolve = promiseCallbacks[msgId].resolve;
  delete promiseCallbacks[msgId];

  resolve(result);
}

function handleInitResponse(msgId, result) {
  if (!promiseCallbacks[msgId]) {
    console.log(`[Indexing] No promise registered for ${msgId}`);
    return;
  }

  var resolve = promiseCallbacks[msgId].resolve;
  var reject = promiseCallbacks[msgId].reject;
  delete promiseCallbacks[msgId];

  if (result === "ready") {
    resolve();
  } else {
    // result === "creating"
    reject();
  }
}

function addFile(serverRelPath) {
  serverRelPath = slash(serverRelPath);
  // find corresponding index
  var subdir = getIndexSubdir(serverRelPath);
  if (!subdir) {
    // no index found for the serverRelPath, so dont add it
    console.log("[Indexing] unknown subdir " + serverRelPath);
    return;
  }
  if (!workers[subdir]) {
    console.log("[Indexing] Cannot add file, no index created for " + subdir);
    return;
  }

  var absPath = toAbsPath(serverRelPath);
  workers[subdir].send({
    type: "addFile",
    idxRelPath: toIdxRelPath(subdir, absPath)
  });
}

function removeFile(serverRelPath) {
  serverRelPath = slash(serverRelPath);
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
    idxRelPath: toIdxRelPath(subdir, absPath)
  });
}


// *** Helper methods ***

function getIndexSubdir(filepath) {
  return Object.keys(workers).find(function(subidx) {
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

  // remove e.g. <rootFolder>/lively4-core/ (including the last slash, therefore + 1)
  return slash(absPath.slice(rootFolder.length + subdir.length + 1));
}

// *** Helper Functions ***

function getNextMsgId() {
  curMsgId++;
  return curMsgId;
}


// *** Export public methods ***

module.exports = {
  setRootFolder: setRootFolder,
  createIndex: createIndex,
  search: search,
  add: addFile,
  remove: removeFile
}
