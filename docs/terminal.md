# Terminal Service Documentation

The Terminal Service provides secure, authenticated terminal access through HTTP REST API and WebSocket connections. It creates PTY (pseudo-terminal) sessions that can be accessed remotely with proper GitHub authentication.

## Authentication

The terminal service supports **two authentication methods**:

### 1. Header-Based Authentication (Traditional)
For API clients and server-to-server communication:
- `gitusername` - GitHub username  
- `gitpassword` - GitHub personal access token

### 2. Session-Based Authentication (WebSocket-Compatible)
For browser clients and WebSocket connections:
1. **Login** via `POST /_auth/login` with GitHub credentials
2. **Receive** session cookie automatically
3. **Use** cookie for all subsequent requests including WebSocket connections

The service uses the same authentication system as other lively4-server services, requiring membership in the configured GitHub organization and team.

## Session Management

### Login Endpoint
**Endpoint:** `POST /_auth/login`  
**Headers:** `gitusername`, `gitpassword`  
**Response:** Sets `lively4-session` cookie + JSON with session info

### Logout Endpoint  
**Endpoint:** `POST /_auth/logout`  
**Response:** Clears session cookie

### Auth Status
**Endpoint:** `GET /_auth/status`  
**Response:** Current authentication status and method

## API Endpoints

### Create Terminal

Creates a new terminal session and returns the process ID.

**Endpoint:** `POST /_terminal/create`

**Query Parameters:**
- `cols` (optional) - Terminal width in columns (default: 80)
- `rows` (optional) - Terminal height in rows (default: 24)

**Headers:**
- `gitusername` - GitHub username (required)
- `gitpassword` - GitHub personal access token (required)
- `cwd` (optional) - Working directory for terminal (default: server process directory)

**Response:** Plain text PID (process ID) of the created terminal

**Example:**
```bash
curl -X POST "http://localhost:8080/_terminal/create?cols=120&rows=30" \
  -H "gitusername: your-github-username" \
  -H "gitpassword: your-github-token" \
  -H "cwd: /path/to/working/directory"
```

**Response:**
```
624398
```

### Resize Terminal

Resizes an existing terminal session.

**Endpoint:** `POST /_terminal/size/:pid`

**Path Parameters:**
- `pid` - Process ID of the terminal to resize

**Query Parameters:**
- `cols` - New terminal width in columns (required)
- `rows` - New terminal height in rows (required)

**Headers:**
- `gitusername` - GitHub username (required)
- `gitpassword` - GitHub personal access token (required)

**Example:**
```bash
curl -X POST "http://localhost:8080/_terminal/size/624398?cols=100&rows=40" \
  -H "gitusername: your-github-username" \
  -H "gitpassword: your-github-token"
```

## WebSocket Connection

Connect to a terminal for real-time input/output via WebSocket.

**Endpoint:** `ws://localhost:8080/_terminal/ws/:pid`

**Path Parameters:**
- `pid` - Process ID of the terminal to connect to

**Headers:**
- `gitusername` - GitHub username (required)
- `gitpassword` - GitHub personal access token (required)

### WebSocket Protocol

1. **Connection**: Upon successful connection, the terminal sends any buffered output
2. **Input**: Send text data to the WebSocket to write to the terminal
3. **Output**: Receive terminal output as text data from the WebSocket
4. **Cleanup**: Terminal is automatically killed when WebSocket connection closes

## Usage Examples

### JavaScript Client Example (Header Auth)

```javascript
// Create a new terminal
const createResponse = await fetch('http://localhost:8080/_terminal/create?cols=80&rows=24', {
  method: 'POST',
  headers: {
    'gitusername': 'your-github-username',
    'gitpassword': 'your-github-token'
  }
});

const pid = await createResponse.text();
console.log('Terminal PID:', pid);

// Connect via WebSocket (Note: Headers won't work in browser!)
const ws = new WebSocket(`ws://localhost:8080/_terminal/ws/${pid}`, {
  headers: {
    'gitusername': 'your-github-username',
    'gitpassword': 'your-github-token'
  }
});

ws.onopen = () => {
  console.log('Connected to terminal');
  // Send a command
  ws.send('ls -la\n');
};

ws.onmessage = (event) => {
  // Display terminal output
  console.log('Terminal output:', event.data);
};

ws.onclose = () => {
  console.log('Terminal connection closed');
};

// Resize terminal
await fetch(`http://localhost:8080/_terminal/size/${pid}?cols=120&rows=30`, {
  method: 'POST',
  headers: {
    'gitusername': 'your-github-username',
    'gitpassword': 'your-github-token'
  }
});
```

### JavaScript Client Example (Session Auth - Browser Compatible)

```javascript
// 1. Login and establish session
const loginResponse = await fetch('http://localhost:8080/_auth/login', {
  method: 'POST',
  headers: {
    'gitusername': 'your-github-username',
    'gitpassword': 'your-github-token'
  }
});

const loginResult = await loginResponse.json();
console.log('Logged in as:', loginResult.username);

// 2. Create terminal (session cookie sent automatically)
const createResponse = await fetch('http://localhost:8080/_terminal/create?cols=80&rows=24', {
  method: 'POST'
  // No headers needed! Cookie sent automatically by browser
});

const pid = await createResponse.text();
console.log('Terminal PID:', pid);

// 3. Connect via WebSocket (session cookie sent automatically)
const ws = new WebSocket(`ws://localhost:8080/_terminal/ws/${pid}`);
// No headers needed! Cookie sent automatically by browser

ws.onopen = () => {
  console.log('Connected to terminal');
  // Send a command
  ws.send('ls -la\n');
};

ws.onmessage = (event) => {
  // Display terminal output
  console.log('Terminal output:', event.data);
};

ws.onclose = () => {
  console.log('Terminal connection closed');
};

// 4. Resize terminal (session cookie sent automatically)
await fetch(`http://localhost:8080/_terminal/size/${pid}?cols=120&rows=30`, {
  method: 'POST'
  // No headers needed! Cookie sent automatically by browser
});

// 5. Optional: Logout when done
await fetch('http://localhost:8080/_auth/logout', { method: 'POST' });
```


### HTML/JavaScript Frontend Example

```html
<!DOCTYPE html>
<html>
<head>
    <title>Lively4 Terminal</title>
    <style>
        #terminal {
            background: black;
            color: white;
            font-family: monospace;
            width: 800px;
            height: 400px;
            overflow-y: scroll;
            padding: 10px;
            white-space: pre-wrap;
        }
        #input {
            width: 800px;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <h1>Lively4 Terminal</h1>
    <div id="terminal"></div>
    <input type="text" id="input" placeholder="Type commands here...">
    
    <script>
        const terminal = document.getElementById('terminal');
        const input = document.getElementById('input');
        
        let ws = null;
        let pid = null;
        
        // Create terminal and connect
        async function connectTerminal() {
            try {
                // Create terminal
                const response = await fetch('/_terminal/create?cols=100&rows=30', {
                    method: 'POST',
                    headers: {
                        'gitusername': 'your-github-username',
                        'gitpassword': 'your-github-token'
                    }
                });
                
                pid = await response.text();
                terminal.textContent += `Connected to terminal ${pid}\n`;
                
                // Connect WebSocket
                ws = new WebSocket(`ws://${location.host}/_terminal/ws/${pid}`, [], {
                    headers: {
                        'gitusername': 'your-github-username', 
                        'gitpassword': 'your-github-token'
                    }
                });
                
                ws.onmessage = (event) => {
                    terminal.textContent += event.data;
                    terminal.scrollTop = terminal.scrollHeight;
                };
                
                ws.onclose = () => {
                    terminal.textContent += '\nTerminal connection closed\n';
                };
                
            } catch (error) {
                terminal.textContent += `Error: ${error.message}\n`;
            }
        }
        
        // Handle input
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(input.value + '\n');
                    input.value = '';
                }
            }
        });
        
        // Connect on page load
        connectTerminal();
    </script>
</body>
</html>
```

## Security Considerations

1. **Authentication Required**: All endpoints require valid GitHub credentials
2. **Organization Membership**: Users must be members of the configured GitHub organization/team
3. **Terminal Cleanup**: Terminals are automatically killed when WebSocket connections close
4. **Process Isolation**: Each terminal runs as a separate process
5. **Working Directory**: Terminals start in a controlled working directory

## Configuration

Terminal service behavior can be configured through server options:

- `authorize-requests`: Enable/disable authentication (default: enabled in production)
- `github-organization`: Required GitHub organization for access
- `github-team`: Required GitHub team within the organization

## Limitations

1. **Shell Type**: Currently uses `/bin/bash` by default
2. **User Context**: Terminals run under the server's user context
3. **Resource Limits**: No built-in limits on terminal resource usage
4. **Concurrency**: Multiple terminals per user are allowed

## Error Responses

- `403 Forbidden`: Authentication failed or insufficient permissions
- `404 Not Found`: Terminal PID not found (for resize operations)
- `500 Internal Server Error`: Terminal creation or operation failed

## Performance Notes

- **Buffered Output**: Terminal output is buffered for 5ms to improve WebSocket performance
- **Memory Usage**: Each terminal maintains a log buffer of all output
- **Cleanup**: Automatic cleanup prevents resource leaks from abandoned terminals