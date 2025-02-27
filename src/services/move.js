import Service from "./service.js";
import { run, logRequest } from '../utils.js';


/*
 * move file or directory
 */
export default class MOVE extends Service {


  async moveResource(source, destination) {
    return run(
      `SOURCE="${source}";
       DESTINATION="${destination}";
       mv -v "$SOURCE" "$DESTINATION";       
       `)
  }

  async request(repositorypath, filepath, req, res) {
    var source = req.url

    var destination = req.headers['destination']
    if (!destination) {
      res.writeHead(404);
      return res.end("destination parameter is missing")
    }

    var re = new RegExp(this.server.options.myurl + "(.*)")
    var m = destination.match(re)

    if (m) {
      destination = m[1]
    } else {
      res.writeHead(404);
      return res.end("Server for destination and source don't match! myurl=" + this.server.options.myurl)
    }

    source = this.server.options.directory + decodeURI(source.substr(1))
    destination = this.server.options.directory + decodeURI(destination)

    var result = await this.moveResource(source, destination)
    logRequest(req, 'MOVE from ' + source + ' to ' + destination)

    if (result.error) {
      res.writeHead(404)
      return res.end("Error " + result.stdout + "\n" + result.stderr)
    }
    res.writeHead(200)
    res.end("moved " + source + " to " + destination)

  }
}
