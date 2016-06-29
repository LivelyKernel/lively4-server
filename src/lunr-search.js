'use strict'

var isNode = (typeof window === 'undefined');

var path, slash, child_process;

var requireHack = require;

if (isNode) {
  path = requireHack("path");
  slash = requireHack("slash");
  child_process = requireHack("child_process");
}

function send(receiver, message) {
  if (isNode) {
    receiver.send(message);
  } else {
    receiver.postMessage(message);
  }
}

function createProcess(script, cwd) {
  if (isNode) {
    let p = child_process.fork(path.join(process.cwd(), script), {
      cwd: toAbsPath(cwd),
      // pipe stdout/stderr into this process
      silent: true
    });

    // handle stdout of child
    p.stdout.on("data", (data) => {
      process.stdout.write(`[Indexing] (${cwd}) ${data}`);
    });

    // handle stderr of child
    p.stderr.on("data", (data) => {
      process.stderr.write(`[Indexing] (${cwd}) ${data}`);
    });

    return p;
  }

  // in Browser:
  return new Worker(script);
}

// Object that holds workers for server subdirectories,
// e.g. '/lively4-core'
var workers = {};
var indexStatus = {};

var promiseCallbacks = {};
// rootFolder is an absolute directory to where the server serves,
// e.g. where the lively4-core folder is found
var rootFolder = null;
var idxFileName = "index.l4idx";

var curMsgId = 0;


// *** Exported methods ***

export function setRootFolder(filepath) {
  // becomes e.g. "C:/felix/bla" on Windows
  if (isNode) {
    rootFolder = slash(path.resolve(filepath));
  } else {
    rootFolder = filepath;
  }
}

export function createIndex(subdir, options) {
  return new Promise((resolve, reject) => {
    if (!rootFolder) {
      console.log("[Indexing] Cannot create index, no root folder set");
      reject("Error: no root folder set");
      return;
    }

    if (indexStatus[subdir] === "ready") {
      console.log("[Indexing] Index already exists");
      resolve();
      return;
    }

    if (indexStatus[subdir] === "indexing") {
      reject();
      return;
    }

    console.log("[Indexing] Starting new worker for " + subdir);
    try {
      let script = isNode ? "lunr-node-search-worker.js" : "../lively4-server/src/lunr-es6-search-worker-wrapper.js"
      workers[subdir] = createProcess(script, subdir);
    } catch (err) {
      console.log("[Indexing] Error starting new worker for " + subdir + ": " + err);
      reject(err);
      return;
    }

    let messageHandler = function(m) {
      switch (m.type) {
        case "search-response":
          handleSearchResponse(m.msgId, m.message);
          break;
        case "init-response":
          handleInitResponse(m.msgId, m.message, subdir);
          break;
        case "error":
          console.log("[Indexing] Error (" + subdir + "): " + m.message);
          break;
      }
    }

    if (isNode) {
      workers[subdir].on("message", messageHandler);
    } else {
      onmessage = messageHandler;
    }


    var msgId = getNextMsgId();
    promiseCallbacks[msgId] = {
      resolve: resolve,
      reject: reject
    }

    send(workers[subdir], {
      type: "init",
      msgId: msgId,
      options: options
    });

    indexStatus[subdir] = "indexing";
  });
}

export function setup(options) {
  return createIndex(options.path, options);
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

  send(workers[subdir], {
    type: "search",
    msgId: msgId,
    query: query
  });

  return p;
}

export function find(pattern) {
  return search(this.path, pattern);
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

function handleInitResponse(msgId, result, subdir) {
  // Worker does not send a msgId, when it had to create the
  // requested index, because the msgId was already used to
  // signal that the index did not exist.
  if (!msgId) {
    // index has been created now,
    // so next call to createIndex will resolve immediately
    indexStatus[subdir] = "ready";
    return;
  }

  if (!promiseCallbacks[msgId]) {
    // this should never happen!
    console.log(`[Indexing] No promise registered for ${msgId}`);
    return;
  }

  var resolve = promiseCallbacks[msgId].resolve;
  var reject = promiseCallbacks[msgId].reject;
  delete promiseCallbacks[msgId];

  if (result === "ready") {
    // index was requested and just had to be loaded from disk
    indexStatus[subdir] = "ready";
    resolve();
  } else {
    // index was requested, does not exist and is being built not
    indexStatus[subdir] = "indexing";
    reject();
  }
}

export function addFile(serverRelPath) {
  // e.g. serverRelPath == "/lively4-core/src/client/foo.js"
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
  send(workers[subdir], {
    type: "addFile",
    idxRelPath: toIdxRelPath(subdir, absPath)
  });
}

export function removeFile(serverRelPath) {
  // e.g. serverRelPath == "/lively4-core/src/client/foo.js"
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
  send(workers[subdir], {
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

if (isNode) {
  module.exports = {
    setRootFolder: setRootFolder,
    createIndex: createIndex,
    search: search,
    add: addFile,
    remove: removeFile
  }
}
