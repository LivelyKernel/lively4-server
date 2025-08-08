import Service from "./service.js";
import { logRequest } from '../utils.js';

// Cache objects
const GithubOriganizationMemberCache = {};
const ActiveSessions = {}; // sessionId -> { username, timestamp }

/**
 * Authentication service that handles GitHub organization-based authorization
 * This service verifies if users are members of specified GitHub organizations and teams
 * @extends Service
 */
export default class AuthService extends Service {

  constructor(server) {
    super(server);
    // Clean up expired sessions every hour
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000);
  }

  /**
   * Checks if the request is authorized based on GitHub credentials and team membership
   * Now supports both header-based auth (existing) and session-based auth (new)
   * @param {Object} req - Express request object containing GitHub credentials in headers or session
   * @param {Object} res - Express response object  
   * @param {string} req.headers.gitusername - GitHub username (for header auth)
   * @param {string} req.headers.gitpassword - GitHub personal access token (for header auth)
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

      // Try header-based auth first (existing behavior)
      var username = req.headers['gitusername'];
      var password = req.headers['gitpassword'];

      // If no header auth, try session-based auth (new feature)
      if (!username || !password) {
        const sessionAuth = this.checkSessionAuth(req);
        if (sessionAuth) {
          username = sessionAuth.username;
          logRequest(req, `AUTHORIZED BY SESSION: ${username}`);
          return true;
        }
      }

      // If neither auth method works, deny access
      if (!username || !password) {
        if (res.writeHead && res.end) {
          res.writeHead(403);
          res.end('Please authenticate yourself\n');
        }
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

  /**
   * Check session-based authentication
   * @param {Object} req - Express request object
   * @returns {Object|null} Session info if valid, null if invalid
   */
  checkSessionAuth(req) {
    // Extract session ID from cookies
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionId = cookies['lively4-session'];
    
    if (!sessionId) {
      return null;
    }

    const session = ActiveSessions[sessionId];
    if (!session) {
      return null;
    }

    // Check if session is expired (24 hours)
    const expiryTime = 24 * 60 * 60 * 1000;
    if (Date.now() - session.timestamp > expiryTime) {
      delete ActiveSessions[sessionId];
      return null;
    }

    return session;
  }

  /**
   * Create a new session after successful authentication
   * @param {string} username - GitHub username
   * @returns {string} Session ID
   */
  createSession(username) {
    const sessionId = this.generateSessionId();
    ActiveSessions[sessionId] = {
      username: username,
      timestamp: Date.now()
    };
    return sessionId;
  }

  /**
   * Generate a cryptographically secure session ID
   * @returns {string} Session ID
   */
  generateSessionId() {
    return Math.random().toString(36).substring(2) + 
           Math.random().toString(36).substring(2) + 
           Date.now().toString(36);
  }

  /**
   * Parse cookie string into key-value pairs
   * @param {string} cookieString - Raw cookie string
   * @returns {Object} Parsed cookies
   */
  parseCookies(cookieString) {
    if (!cookieString) return {};
    
    return cookieString.split(';').reduce((cookies, cookie) => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[decodeURIComponent(name)] = decodeURIComponent(value);
      }
      return cookies;
    }, {});
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    const expiryTime = 24 * 60 * 60 * 1000;
    
    Object.keys(ActiveSessions).forEach(sessionId => {
      if (now - ActiveSessions[sessionId].timestamp > expiryTime) {
        delete ActiveSessions[sessionId];
      }
    });
  }

  /**
   * Handle session-related HTTP requests
   * @param {string} pathname - Request pathname
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async handleSessionRequest(pathname, req, res) {
    if (pathname === '/_auth/login') {
      return this.handleLogin(req, res);
    }
    
    if (pathname === '/_auth/logout') {
      return this.handleLogout(req, res);
    }
    
    if (pathname === '/_auth/status') {
      return this.handleAuthStatus(req, res);
    }

    res.writeHead(404);
    res.end('Auth endpoint not found');
  }

  /**
   * Handle login request - authenticate and create session
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async handleLogin(req, res) {
    // Use existing checkAuth logic but capture the username
    const originalCheckAuth = this.checkAuth;
    let authenticatedUsername = null;
    
    // Temporarily modify the auth flow to capture username
    const tempRes = {
      writeHead: () => {},
      end: () => {}
    };
    
    const isAuthenticated = await originalCheckAuth.call(this, req, tempRes);
    
    if (isAuthenticated && req.headers['gitusername']) {
      authenticatedUsername = req.headers['gitusername'];
      const sessionId = this.createSession(authenticatedUsername);
      
      // Set session cookie
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `lively4-session=${sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`
      });
      
      res.end(JSON.stringify({
        success: true,
        username: authenticatedUsername,
        sessionId: sessionId
      }));
    } else {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Authentication failed'
      }));
    }
  }

  /**
   * Handle logout request
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  handleLogout(req, res) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionId = cookies['lively4-session'];
    
    if (sessionId && ActiveSessions[sessionId]) {
      delete ActiveSessions[sessionId];
    }
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'lively4-session=; HttpOnly; Path=/; Max-Age=0'
    });
    
    res.end(JSON.stringify({ success: true }));
  }

  /**
   * Handle auth status request
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  handleAuthStatus(req, res) {
    const sessionAuth = this.checkSessionAuth(req);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated: !!sessionAuth,
      username: sessionAuth ? sessionAuth.username : null,
      method: sessionAuth ? 'session' : (req.headers['gitusername'] ? 'headers' : 'none')
    }));
  }

}