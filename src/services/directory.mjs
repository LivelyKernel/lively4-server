import Service from "./service.mjs";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';
import mime from 'mime-types';
import fs from 'fs';


export default class DirectoryService extends Service {

  readDirectory(aPath, req, res, contentType) {
    fs.readdir(aPath, function (err, files) {
      var dir = {
        type: 'directory',
        contents: []
      };

      var checkEnd = () => {
        // is there a better way for synchronization???
        if (dir.contents.length === files.length) {
          var data;
          if (contentType == 'text/html') {
            // prefix the directory itself as needed if it does not end in "/"
            var match = req.url.match(/\/([^/]+)$/); // aPath stripped the / already
            var prefix = match ? match[1] + '/' : '';


            data =
              `<html><style>
  body { 
    font-family: arial;
  }
 </style><body><h1>` +
              req.url +
              '</h1>\n<ul>' +
              // '<!-- prefix=' +
              // `PATH: ${aPath} PREFIX: ${prefix} URL: ${req.url} URL2: ${JSON.stringify(req.headers)}}` +
              // ' -->' +


              dir.contents.sort()
                .map(ea => ea.name)
                .sort()
                .map(function (ea) {
                  return (
                    "<li><a href='" +
                    prefix +
                    ea +
                    "'>" +
                    ea +
                    '</a></li>'
                  );
                })
                .join('\n') +
              '</ul></body></html>';

            // github return text/plain, therefore we need to do the same
            res.writeHead(200, {
              'content-type': 'text/html'
            });
            res.end(data);
          } else {
            data = JSON.stringify(dir, null, 2);
            // github return text/plain, therefore we need to do the same
            res.writeHead(200, {
              'content-type': 'text/plain'
            });
            res.end(data);
          }
        }
      };
      checkEnd();
      files.forEach(function (filename) {
        var filePath = Path.join(aPath, filename);
        fs.stat(filePath, function (err, statObj) {
          if (!statObj) {
            dir.contents.push({
              type: 'file',
              name: filename,
              size: 0
            });
          } else if (statObj.isDirectory()) {
            dir.contents.push({
              type: 'directory',
              name: filename,
              size: 0
            });
          } else {
            dir.contents.push({
              type: 'file',
              name: filename,
              size: statObj.size
            });
          }
          checkEnd();
        });
      });
    });
  }


}