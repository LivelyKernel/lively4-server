import Service from "./service.js";
import { run, cleanString } from "../utils.js";

/**
 * BIBTEX Service class implements a search for BibTeX entries
 * @extends Service
 */
export default class BIBTEX extends Service {

  /**
   * Handles BIBTEX request to search for BibTeX entries
   * @param {string} request - Search request
   * @param {http.ServerResponse} res - HTTP response object
   * @returns {Promise<void>} - Resolves when search is complete
   */
  async request(request, res) {
    const query = cleanString(URL.parse(req.url, true).query["search"]);
    var result = await run(`${this.server}/bin/search-bibtex.py "${query}"`);
    res.writeHead(200);
    res.end(result.stdout);
  }
}
