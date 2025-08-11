# Terminal Service Documentation

The Terminal Service provides secure, authenticated terminal access through HTTP REST API and WebSocket connections. It creates PTY (pseudo-terminal) sessions that can be accessed remotely with proper GitHub authentication.

## Authentication

The terminal service uses the same authentication system as other lively4-server services. For detailed information about authentication methods, security considerations, and implementation examples, see the [Authentication Documentation](auth.md).

**Quick Summary:**
- **Header-based auth:** For API clients and server-to-server communication
- **Session-based auth:** Required for browser WebSocket connections
- Both methods require GitHub credentials and organization membership

## API Endpoints

### Create Terminal

Creates a new terminal session and returns the process ID.

**Endpoint:** `POST /_terminal/create`

**Query Parameters:**
- `cols` (optional) - Terminal width in columns (default: 80)
- `rows` (optional) - Terminal height in rows (default: 24)

**Headers:**
- `cwd` (optional) - Working directory for terminal (default: server process directory)

**Response:** Plain text PID (process ID) of the created terminal

**Example:**
```bash
curl -X POST "http://localhost:9005/_terminal/create?cols=120&rows=30" \
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

**Example:**
```bash
curl -X POST "http://localhost:9005/_terminal/size/624398?cols=100&rows=40" \
  -H "gitusername: your-github-username" \
  -H "gitpassword: your-github-token"
```

## WebSocket Connection

Connect to a terminal for real-time input/output via WebSocket.

**Endpoint:** `ws://localhost:9005/_terminal/ws/:pid`

**Path Parameters:**
- `pid` - Process ID of the terminal to connect to

**Authentication:**
- Uses session cookies (automatically sent by browser after `/_auth/login`)
- Header-based auth **does not work** with WebSocket connections in browsers

### WebSocket Protocol

1. **Connection**: Upon successful connection, the terminal sends any buffered output
2. **Input**: Send text data to the WebSocket to write to the terminal
3. **Output**: Receive terminal output as text data from the WebSocket
4. **Cleanup**: Terminal is automatically killed when WebSocket connection closes

## Usage Example

Simple JavaScript example that executes `ls -l` command and logs the output:

```javascript
async function runTerminalCommand() {
  try {
    // 1. Login and establish session
    const loginResponse = await fetch('http://localhost:9005/_auth/login', {
      method: 'POST',
      headers: {
        'gitusername': 'your-github-username',
        'gitpassword': 'your-github-token'
      }
    });

    const loginResult = await loginResponse.json();
    console.log('Logged in as:', loginResult.username);

    // 2. Create terminal
    const createResponse = await fetch('http://localhost:9005/_terminal/create?cols=80&rows=24', {
      method: 'POST'
    });

    const pid = await createResponse.text();
    console.log('Terminal PID:', pid);

    // 3. Connect WebSocket and execute command
    const ws = new WebSocket(`ws://localhost:9005/_terminal/ws/${pid}`);
    
    let commandSent = false;

    ws.onopen = () => {
      console.log('Connected to terminal');
    };

    ws.onmessage = (event) => {
      console.log(event.data);
      
      // Send command after seeing the initial prompt
      if (!commandSent && event.data.includes('$')) {
        commandSent = true;
        setTimeout(() => {
          ws.send('ls -l\n');
        }, 100); // Small delay to ensure prompt is ready
      }
    };

    ws.onclose = () => {
      console.log('Terminal connection closed');
    };

  } catch (error) {
    console.error('Error:', error.message);
  }
}

runTerminalCommand();

```

## Security Considerations

1. **Authentication Required**: All endpoints require valid GitHub credentials
2. **Organization Membership**: Users must be members of the configured GitHub organization/team
3. **Terminal Cleanup**: Terminals are automatically killed when WebSocket connections close
4. **Process Isolation**: Each terminal runs as a separate process
5. **Working Directory**: Terminals start in a controlled working directory


## Limitations

1. **Shell Type**: Currently uses `/bin/bash` by default
2. **User Context**: Terminals run under the server's user context
3. **Resource Limits**: No built-in limits on terminal resource usage
4. **Concurrency**: Multiple terminals per user are allowed

## Performance Notes

- **Buffered Output**: Terminal output is buffered for 5ms to improve WebSocket performance
- **Memory Usage**: Each terminal maintains a log buffer of all output
- **Cleanup**: Automatic cleanup prevents resource leaks from abandoned terminals