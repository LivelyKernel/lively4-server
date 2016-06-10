'use strict'

var isNode = (typeof window === 'undefined');

var lunr = require("lunr");
var slash = require("slash");
var path = require("path");
var fs = require("fs");
var jsTokens = require("js-tokens");
var cp = require("./lunr-node-content-provider.js");

function send(message) {
  if (isNode) {
    process.send(message);
  } else {
    postMessage(message);
  }
}

function exit() {
  if (isNode) {
    process.exit();
  } else {
    close();
  }
}

function log(string) {
  if (isNode) {
    // if the string doesnt end with \r append \n
    string += string.slice(-1) !== "\r" ? "\n" : "";
    process.stdout.write(string);
  } else {
    console.log(string);
  }
}

// lunr index object
var index = null;

var idxFileName = "index.l4idx";

function messageHandler(m) {
  if (!index && m.type !== "init") {
    init();
  }

  switch (m.type) {
    case "init":
      init(m.msgId);
      break;
    case "addFile":
      addFile(m.idxRelPath);
      break;
    case "removeFile":
      removeFile(m.idxRelPath);
      break;
    case "search":
      search(m.query, m.msgId);
      break;
    case "stop":
      stop();
      break;
    default:
      send({
        type: "error",
        message: "Unknown message type"
      });
  }
}

if (isNode) {
  process.on("message", messageHandler);
} else {
  onmessage = messageHandler;
}


// *** Message handlers ***

function init(msgId) {
  if (index) {
    return;
  }

  var jsTokenizer = function (obj) {
    if (!arguments.length || obj == null || obj == undefined) return []
    if (Array.isArray(obj)) return obj.map(function (t) { return lunr.utils.asString(t).toLowerCase() })

    return obj.toString().trim().toLowerCase().match(jsTokens).filter(function(token) { return token.length < 30; });
  }

  // register tokenizer function to allow index serialization
  lunr.tokenizer.registerFunction(jsTokenizer, "jsTokenizer");

  // check for existing index file
  try {
    let jsonData = cp.loadIndexJson(idxFileName);
    log("Found existing index, load it");

    index = lunr.Index.load(jsonData);

    send({
      type: "init-response",
      msgId: msgId,
      message: "ready"
    });
  } catch (err) {
    // no index found
    send({
      type: "init-response",
      msgId: msgId,
      message: "indexing"
    });

    // setup the index
    index = lunr(function() {
      this.field("filename");
      this.field("content");

      this.ref("path");
    });

    // TODO: clear stopwords!!!

    // set the js tokenizer
    index.tokenizer(jsTokenizer);

    createIndex();
    send({
      type: "init-response",
      message: "ready"
    });
  }
}

function createIndex() {
  var files = cp.FileReader();

  var counter = 0;
  for (var file of files) {
    counter++;
    log(`Indexing file ${counter}\r`);

    addDocumentToIndex(file);
  }

  saveIndexFile();
}

function addFile(relPath) {
  log("about to add");
  var files = cp.FileReader([relPath]);
  log("adding file " + relPath);
  for (var file of files) {
    addDocumentToIndex(file);
  }
  log("added file");

  saveIndexFile();
}

function removeFile(_relPath) {
  var relPath = slash(path.normalize(_relPath));
  index.remove({
    path: relPath
  });

  saveIndexFile();
}

function search(query, msgId) {
  var result = index.search(query);

  send({
    type: "search-response",
    msgId: msgId,
    message: result
  });
}

function stop() {
  saveIndexFile();
  exit();
}


// *** Internal methods ***

function addDocumentToIndex(doc) {
  index.remove({
    path: doc.path
  });

  index.add({
    path: doc.path,
    filename: doc.filename,
    content: doc.content
  });
}

function saveIndexFile() {
  try {
    cp.saveIndexJson(index, idxFileName);
    if (isNode) {
      log("Written index to " + path.join(process.cwd(), idxFileName));
    } else {
      log("Written index " + idxFileName);
    }
  } catch (err) {
    log("Error saving index file: " + err);
  }
}
