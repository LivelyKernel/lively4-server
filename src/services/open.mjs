import Service from "./service.mjs";
import { respondWithCMD } from "../utils.js";

/**
 * Service to handle opening files in the system's default application
 * @extends {Service}
 */
export default class OPEN extends Service {

  /**
   * Handles the OPEN request by using the system's 'open' command
   * @param {string} path - The full request path
   * @param {http.IncomingMessage} req - HTTP request object
   * @param {http.ServerResponse} res - HTTP response object
   * @returns {Promise<void>} Promise that resolves when the command is executed
   */
  async request(path, req, res) {
    console.log("OPEN " + path)
    var relativePath = path.replace(/.*_open\//, "")
    var dir = relativePath.replace(/[^/]*$/, "")
    var file = relativePath.replace(/.*\//, "")

    return respondWithCMD("cd \"" + this.server.lively4DirUnix + dir + "\"; open \"" + file + "\"", res)
  }
}