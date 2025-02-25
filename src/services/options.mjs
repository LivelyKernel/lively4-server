import Service from "./service.mjs";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, } from '../utils.js';

export default class OPTIONS extends Service {
  
  /*
   * list directory contents and file meta information
   */
  async request(repositorypath, filepath, req, res) {
    var fullpath = Path.join(repositorypath, filepath)
    logRequest(req, 'OPTIONS ' + fullpath)
    var after = req.headers['gitafter']
    var until = req.headers['gituntil']

    try {
      var stats = await fs_stat(fullpath);
    } catch (err) {
      logRequest(req, 'stat ERROR: ' + err)
      if (err.code == 'ENOENT') {
        res.writeHead(200)
        let data = JSON.stringify({ error: err }, null, 2)
        res.end(data)
      } else {
        logRequest(req, err)
      }
      return
    }
    if (stats.isDirectory()) {
      if (req.headers['showversions'] == 'true') {
        return this.listVersions(repositorypath, filepath, res, after, until);
      }

      if (req.headers['filelist'] == 'true') {
        this.readFilelist(repositorypath, filepath, res);
      } else {
        this.server.directoryService.readDirectory(fullpath, req, res);
      }
    } else if (stats.isFile()) {
      if (req.headers['showversions'] == 'true') {
        return this.listVersions(repositorypath, filepath, res, after, until);
      }
      let data = await this.server.readOptions(repositorypath, filepath, stats)
      res.writeHead(200, {
        'content-type': 'text/plain' // github return text/plain, therefore we need to do the same
      });
      res.end(JSON.stringify(data, null, 2))
    }
  }

  listVersions(repositorypath, filepath, res, after, until) {
    // #TODO rewrite artificial json formatting and for example get rit of trailing "null"
    var format =
      '\\{\\"version\\":\\"%h\\",\\"date\\":\\"%ad\\",\\"author\\":\\"%an\\"\\,\\"parents\\":\\"%p\\",\\"comment\\":\\"%f\\"},';

    // #TODO #Security #Parameters?
    var range = `${after ? '--after="' + after + '"' : ""} ${until ? '--until="' + until + '"' : ""}`

    respondWithCMD(
      `cd ${repositorypath};
      echo "{ \\"versions\\": [";
      git log --pretty=format:${format} ${range} ${filepath};
      echo null\\]}`,
      res
    );
  }

  /*
   * recursively list directories and with modification date of files
   * #Idea (should be used to update caches)
   */
  async readFilelist(repositorypath, filepath, res) {
    var result = await run(
      `cd "${repositorypath}/${filepath}"; find -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS\t%y\t%s\t%p\n"`
    );
    var list = result.stdout
      .split('\n')
      .map(line => {
        var row = line.split('\t');
        return {
          modified: row[0],
          type: row[1] == 'd' ? 'directory' : 'file',
          size: row[2],
          name: row[3]
        };
      })
      .filter(ea => ea.name && ea.name !== '.');
    if (result.error) {
      console.error("readFilelist stderr " + result.stderr)
      console.error("readFilelist: " + result.error)
    }
    // console.log("readFilelist found " + list.length + " files")
    res.writeHead(200, {
      'content-type': 'json'
    });
    res.end(
      JSON.stringify({
        type: 'filelist',
        contents: list
      })
    );
  }

}