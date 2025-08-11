# Authentication Documentation

The lively4-server supports **two authentication methods** to accommodate different client types and use cases. Both methods use GitHub credentials and require membership in the configured GitHub organization and team.

## Authentication Methods Overview

### 1. Header-Based Authentication (Traditional)

**Use Case:** API clients, server-to-server communication, automation scripts

**How it works:**
- Include GitHub credentials in HTTP headers with every request
- `gitusername` - GitHub username  
- `gitpassword` - GitHub personal access token

**Advantages:**
- Simple to implement for API clients
- Stateless - no session management needed
- Works well for one-off requests and automation

**Limitations:**
- Credentials sent with every request
- **Does not work with WebSocket connections in browsers** - browsers don't support custom headers for WebSocket connections
- Less secure for interactive applications

### 2. Session-Based Authentication (WebSocket-Compatible)

**Use Case:** Browser applications, WebSocket connections, interactive user applications

**How it works:**
1. **Login** via `POST /_auth/login` with GitHub credentials in headers
2. **Receive** session cookie (`lively4-session`) automatically set by server
3. **Use** cookie for all subsequent requests - browser sends it automatically

**Advantages:**
- **Required for WebSocket connections** in browsers
- More secure - credentials only sent once during login
- Better user experience for interactive applications
- Automatic cookie management by browser

**Limitations:**
- Requires session management
- More complex for simple API clients

## Standard Header-Based Authentication

Header authentication follows standard HTTP authentication patterns used throughout the web:

```http
POST /_terminal/create
Host: localhost:8080
gitusername: your-github-username
gitpassword: ghp_your_github_personal_access_token
```

### Standard HTTP Authentication Headers

While lively4-server uses custom headers (`gitusername`/`gitpassword`), standard HTTP authentication typically uses:

- **Basic Authentication:** `Authorization: Basic base64(username:password)`
- **Bearer Token:** `Authorization: Bearer token`
- **Custom Headers:** Application-specific headers (like our approach)

**Why Custom Headers?**
- Direct GitHub integration without encoding/decoding
- Clear separation of username and token
- Explicit field naming for better debugging

### Header Authentication Examples

**curl:**
```bash
curl -X POST "http://localhost:8080/_terminal/create" \
  -H "gitusername: your-github-username" \
  -H "gitpassword: ghp_your_token"
```

**JavaScript (fetch):**
```javascript
const response = await fetch('http://localhost:8080/_terminal/create', {
  method: 'POST',
  headers: {
    'gitusername': 'your-github-username',
    'gitpassword': 'ghp_your_token'
  }
});
```

**Node.js WebSocket (with headers support):**
```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080/_terminal/ws/12345', {
  headers: {
    'gitusername': 'your-github-username',
    'gitpassword': 'ghp_your_token'
  }
});
```

## Session-Based Authentication for WebSocket

WebSocket connections in browsers **cannot use custom headers** due to browser security restrictions. This is where session authentication becomes essential.

### The WebSocket Header Problem

**Browser Limitation:**
```javascript
// ❌ This DOES NOT WORK in browsers
const ws = new WebSocket('ws://localhost:8080/_terminal/ws/12345', {
  headers: {
    'gitusername': 'username',
    'gitpassword': 'token'
  }
});

// ❌ Browser WebSocket API doesn't support custom headers
const ws = new WebSocket('ws://localhost:8080/_terminal/ws/12345');
ws.setRequestHeader('gitusername', 'username'); // Method doesn't exist
```

**Why headers don't work:**
- Browser WebSocket API only supports protocol negotiation headers
- Security restrictions prevent arbitrary header modification
- Only cookies and URL parameters can be used for authentication

### Session Authentication Solution

**Step 1: Establish Session**
```javascript
// Login to create session
const loginResponse = await fetch('/_auth/login', {
  method: 'POST',
  headers: {
    'gitusername': 'your-github-username',
    'gitpassword': 'ghp_your_token'
  }
});

// Server sets 'lively4-session' cookie automatically
```

**Step 2: WebSocket Connection**
```javascript
// ✅ This WORKS - cookie sent automatically by browser
const ws = new WebSocket('ws://localhost:8080/_terminal/ws/12345');
// No headers needed! Browser sends session cookie automatically
```

### Session Authentication Flow

1. **Client Authentication Request:**
   ```http
   POST /_auth/login HTTP/1.1
   Host: localhost:8080
   gitusername: your-github-username
   gitpassword: ghp_your_token
   ```

2. **Server Response with Session Cookie:**
   ```http
   HTTP/1.1 200 OK
   Set-Cookie: lively4-session=abc123...; HttpOnly; Path=/; SameSite=Strict
   Content-Type: application/json
   
   {"username": "your-github-username", "authenticated": true}
   ```

3. **Subsequent Requests (automatic):**
   ```http
   GET /_terminal/create HTTP/1.1
   Host: localhost:8080
   Cookie: lively4-session=abc123...
   ```

4. **WebSocket Connection (automatic):**
   ```http
   GET /_terminal/ws/12345 HTTP/1.1
   Host: localhost:8080
   Upgrade: websocket
   Connection: Upgrade
   Cookie: lively4-session=abc123...
   ```

### Complete Browser Example

```javascript
class TerminalAuth {
  async login(username, token) {
    const response = await fetch('/_auth/login', {
      method: 'POST',
      headers: {
        'gitusername': username,
        'gitpassword': token
      }
    });
    
    if (!response.ok) {
      throw new Error('Authentication failed');
    }
    
    return await response.json();
  }
  
  async createTerminal(cols = 80, rows = 24) {
    // Session cookie sent automatically by browser
    const response = await fetch(`/_terminal/create?cols=${cols}&rows=${rows}`, {
      method: 'POST'
      // No headers needed!
    });
    
    return await response.text(); // Returns PID
  }
  
  connectWebSocket(pid) {
    // Session cookie sent automatically by browser
    const ws = new WebSocket(`ws://${location.host}/_terminal/ws/${pid}`);
    // No headers needed!
    
    return ws;
  }
  
  async logout() {
    await fetch('/_auth/logout', { method: 'POST' });
  }
}

// Usage
const auth = new TerminalAuth();
await auth.login('username', 'ghp_token');
const pid = await auth.createTerminal(100, 30);
const ws = auth.connectWebSocket(pid);
```

## Security Considerations

### Header Authentication Security
- **Transmission Security:** Always use HTTPS to protect credentials in transit
- **Token Management:** Use GitHub personal access tokens, not passwords
- **Token Scope:** Limit token permissions to minimum required access
- **Logging:** Never log authentication headers

### Session Authentication Security
- **Cookie Security:** HttpOnly, Secure, SameSite attributes protect session cookies
- **Session Expiry:** Sessions have configurable timeout periods
- **CSRF Protection:** SameSite=Strict prevents cross-site request forgery
- **Session Invalidation:** Logout properly clears session data

### Authentication Endpoints

**Login:** `POST /_auth/login`
- **Headers:** `gitusername`, `gitpassword`
- **Response:** Sets session cookie + JSON status
- **Use:** Establish authenticated session

**Logout:** `POST /_auth/logout`  
- **Response:** Clears session cookie
- **Use:** Clean session termination

**Status:** `GET /_auth/status`
- **Response:** Current authentication status
- **Use:** Check authentication state

## Choosing the Right Method

### Use Session Authentication When:
- Building browser applications
- Using WebSocket connections
- Creating interactive user interfaces
- Need better security for credential handling
- Users will make multiple requests

### Use Header Authentication When:
- Building API clients or automation scripts
- Server-to-server communication
- Using Node.js WebSocket libraries with header support
- One-off requests or simple operations
- Stateless operation is preferred

### Summary

Session authentication is **required** for WebSocket connections in browsers due to security restrictions, while header authentication works well for API clients and server-to-server communication. The lively4-server supports both methods to accommodate the full range of client types and use cases.