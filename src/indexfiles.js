
// import lunrSearch from "./lively4-search/shared/lunr-search.js";


 // {
  //   name: "index-files",
  //   long: "i",
  //   type: "boolean",
  //   description: "indexing files for search",
  //   example: "'node --index-files=true'"
  // }, 

// #Idea indexing of files should be handled by observing the file system, because git changes files too
// if (indexFiles) {
//   // ..
//   log("[search] WARNING, option is disabled at the moment");  
  
// } else {
//   log("[search] indexing files is disabled");  
// }

// if (indexFiles) {
//   log("[search] setRootFolder " + sSourceDir);
//   lunrSearch.setRootFolder(sSourceDir);
// }


   // if (indexFiles) {
        //   try {
        //     lunrSearch.addFile(fullpath); // #TODO #BUG what path does lunr accept?
        //   } catch(e) {
        //     log("Error indexing file, but conitue anyway: " + e);
        //   }
        // }


  // if (indexFiles) {
  //   try {
  //     lunrSearch.removeFile(sPath);
  //   } catch(e) {
  //     log("[search] Error removing file, but conitue anyway: " + e)
  //   }
  // }

    // if (pathname.match(/\/api\/search.*/)) {
    //  return searchFilesWithIndex(sPath, req, res);
    // }

function searchFilesWithIndex(sPath, req, res) {
  if (!indexFiles) {
      res.writeHead(503);
      return res.end("Index server not running ");
  }
  var urlParts = url.parse(req.url, true);
  var query = urlParts.query;
  var location = query.location;

  if (sPath.match(/\/api\/search\/createIndex.*/)) {
    
    try {
      lunrSearch.createIndex(location).then(() => {
        // index is available
        log("[Search] index available in location: " + location);
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({indexStatus: "available"}));
      }, (err) => {
        // index not available yet
        log("[Search] index not yet available in location: " + location + " Error: " + err);
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({indexStatus: "indexing"}));
      });
    } catch(e) {
      log("[Search] could not create index, but conitue anyway: " + e)
      res.writeHead(500, {"Content-Type": "application/json"});
      res.end("Creating index failed due: " + e);
      return
    }

  } else if (sPath.match(/\/api\/search\/statusIndex.*/)) {
    lunrSearch.getStatus(location).then(status => {
      log(`[Search] check index status for ${location}: ${status}`);
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({indexStatus: status}));
    });
  } else if (sPath.match(/\/api\/search\/removeIndex.*/)) {
    lunrSearch.removeIndex(location).then(() => {
      log("[Search] index removed in location: " + location);
      res.writeHead(200, "OK");
      res.end();
    });
  } else {
    var pattern = query.q;
    log("[Search] search: " + pattern + " in location: " + location);
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
