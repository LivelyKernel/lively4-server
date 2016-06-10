'use strict'

var fs = require("fs");
var slash = require("slash");
var path = require("path");

// this function throws an error if the index file does not exist
function loadIndexJson(l4idxFile) {
  fs.accessSync(l4idxFile, fs.R_OK | fs.W_OK);
  // l4idxFile exists and is accessible to rw, load it
  let data = fs.readFileSync(l4idxFile);
  return JSON.parse(data);
}

function saveIndexJson(jsonIndex, filename) {
  var serialized = JSON.stringify(jsonIndex.toJSON());
  fs.writeFileSync(filename, serialized);
}

function getFilepaths() {
  var relFilePaths = [];
  (function walk(rootDir) {
    fs.readdirSync(rootDir).forEach(function(file) {
      var stat = fs.statSync(path.join(rootDir, file));
      if (stat.isDirectory()) {
        walk(path.join(rootDir, file));
      } else if (stat.isFile()) {
        // just index js-files for now, with size < 500kB
        if (file.slice(-3) === ".js" && stat.size < 500000) {
        // if (file.slice(-3) === ".js") {
          relFilePaths.push(path.join(rootDir, file));
        }
      }
    });
  })("./");

  return relFilePaths;
}

function* FileReader(filePaths) {
  if (filePaths === undefined) {
    filePaths = getFilepaths();
  }

  for (let i = 0; i < filePaths.length; i++) {
    let relPath = slash(path.normalize(filePaths[i]));
    let parsedPath = path.parse(relPath);
    yield {
      path: relPath,
      filename: parsedPath.base,
      content: fs.readFileSync(relPath, 'utf8')
    }
  }
}

module.exports = {
  loadIndexJson: loadIndexJson,
  saveIndexJson: saveIndexJson,
  FileReader: FileReader
}
