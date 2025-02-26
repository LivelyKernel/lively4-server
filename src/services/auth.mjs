import Service from "./service.mjs";

import { logRequest } from '../utils.js';

// Cache objects
const GithubOriganizationMemberCache = {};


export default class AuthService extends Service {

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

      // log("user " + username)
      // log("password " + (password + "").slice(0,3))

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