import Service from "./service.js";
import { logRequest } from '../utils.js';

// Cache objects
const GithubOriganizationMemberCache = {};

/**
 * Authentication service that handles GitHub organization-based authorization
 * This service verifies if users are members of specified GitHub organizations and teams
 * @extends Service
 */
export default class AuthService extends Service {

  /**
   * Checks if the request is authorized based on GitHub credentials and team membership
   * @param {Object} req - Express request object containing GitHub credentials in headers
   * @param {Object} res - Express response object
   * @param {string} req.headers.gitusername - GitHub username
   * @param {string} req.headers.gitpassword - GitHub personal access token
   * @returns {Promise<boolean>} Returns true if authorized, false otherwise
   */
  async checkAuth(req, res) {

    // log("authorize-requests: " + this.server.options["authorize-requests"])
    if (this.server.options["authorize-requests"]) {
      // log("AUTH REQUIRED")

      var org = this.server.options["github-organization"]
      if (!org) {
        logRequest(req, "CONFIG ERROR: github-organization is missing")
      }
      var teamName = this.server.options["github-team"]
      if (!teamName) {
        logRequest(req, "CONFIG ERROR: github-team is missing")
      }

      var username = req.headers['gitusername'];
      var password = req.headers['gitpassword'];


      if (!username || !password) {
        res.writeHead(403);
        res.end('Please authenticate yourself\n');
        return false;
      }

      // cache the authorization to go light on the github API and answer faster ourselves
      var authorizationKey = org + "/" + org + "/" + username + "/" + password
      var lastAuthorization = GithubOriganizationMemberCache[authorizationKey]
      if (lastAuthorization && lastAuthorization.success) {
        logRequest(req, "AUTHORIZED BY CACHE")
        // do nothing
      } else {
        logRequest(req, "AUTHORIZATION required org: " + org + " team: " + teamName)
        let teamInfo = await fetch(`https://api.github.com/orgs/${org}/teams/${teamName}`, {
          method: "GET",
          headers: {
            Authorization: "token " + password
          }
        }).then(r => r.json());

        if (teamInfo.members_url) {
          var members = await fetch(teamInfo.members_url.replace(/\{.*/, ""), {
            method: "GET",
            headers: {
              Authorization: "token " + password
            }
          }).then(r => r.json());
          var userInTeam = members.map(ea => ea.login).includes(username)
        }

        if (!userInTeam) {
          GithubOriganizationMemberCache[authorizationKey] = {
            success: false,
            time: Date.now(),
            previous: lastAuthorization // for preventing... DoS attacks? #TODO
          }
          res.writeHead(403);
          res.end('Authentification/Authorization failed\n');
          return false;
        }

        GithubOriganizationMemberCache[authorizationKey] = {
          success: true,
          time: Date.now()
        }
      }
      return true
    } else {
      return true
    }
  }

}