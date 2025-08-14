# Lively4 MCP Integration

This document describes the Model Context Protocol (MCP) integration for Lively4, enabling Claude Code to interact with live Lively4 development environments.

## Architecture

### Two-Connection Design

1. **Browser ↔ lively4-server** (WebSocket `/_mcp-session`)
   - Session registration and management
   - Code evaluation requests/responses
   - Real-time communication

2. **Claude Code ↔ lively4-server** (MCP Protocol via stdio)
   - Standard MCP tools interface
   - Session targeting for multi-user support
   - Authentication and security

### Components

- `lively-mcp` component (browser): Visual agent avatar with session management
- `McpSessionService` (server): WebSocket session management
- `Lively4McpServer` (server): MCP protocol implementation using `@modelcontextprotocol/sdk`

## Available MCP Tools

### `evaluate_code`
Execute JavaScript code in a specific Lively4 browser session.

**Parameters:**
- `sessionId` (string): Target session ID from active browser
- `code` (string): JavaScript code to evaluate
- `timeout` (number, optional): Timeout in milliseconds (default: 30000)

**Example:**
```javascript
{
  "name": "evaluate_code",
  "arguments": {
    "sessionId": "abc123...",
    "code": "2 + 2"
  }
}
```

### `list_sessions`
List all active Lively4 browser sessions.

**Returns:** Array of session information including IDs, registration times, and connection status.

### `ping_sessions`
Ping all active sessions to check connectivity.

**Returns:** Count of successful pings vs total sessions.

## Usage Instructions

### 1. Start the Server
```bash
cd lively4-server
npm start
# Server starts on http://localhost:9006 with MCP integration
```

### 2. Open Browser Session
1. Navigate to `http://localhost:9006`
2. Open the MCP component: `lively.openComponentInWindow('lively-mcp')`
3. Component will show session ID and connection status

### 3. Use with Claude Code
Configure Claude Code to connect to the MCP server:

```json
{
  "mcpServers": {
    "lively4": {
      "command": "node",
      "args": ["path/to/lively4-server/src/http-server.js"],
      "cwd": "path/to/lively4-server"
    }
  }
}
```

### 4. Test the Integration
Run the test client:
```bash
cd lively4-server
node test-mcp-client.js
```

## API Endpoints

### WebSocket Endpoints
- `/_mcp-session` - Browser session registration and communication

### REST Endpoints  
- `GET /_mcp/status` - Server status and session information
- `GET /_mcp/sessions` - List active sessions
- `POST /_mcp/ping-sessions` - Ping all sessions

## Security Considerations

- Browser sessions are isolated by unique session IDs
- Code evaluation happens in browser context with existing permissions
- No additional authentication required beyond existing Lively4 GitHub auth
- MCP protocol provides standard security patterns for tool execution

## Development Notes

### Session Flow
1. Browser loads `lively-mcp` component
2. Component generates unique session ID (UUID)
3. WebSocket connects to `/_mcp-session` with session ID
4. Server registers session in `McpSessionService`
5. Claude Code can target specific sessions for code evaluation
6. Results returned via WebSocket → MCP protocol

### Multi-User Support
Each browser tab/window gets a unique session ID, enabling:
- Multiple developers on same server
- Session-specific code evaluation
- Independent development environments

### Error Handling
- Timeout protection for code evaluation (30s default)
- Connection recovery for WebSocket sessions
- Graceful degradation when no sessions available

## Extending the Integration

### Adding New Tools
1. Register tool in `Lively4McpServer.registerTools()`
2. Implement handler method following existing patterns
3. Add corresponding message types in `McpSessionService`
4. Update browser component for new functionality

### Custom Evaluation Contexts
The `evaluate_code` tool can be extended to support:
- Sandboxed evaluation contexts
- Persistent variable scopes
- Module-specific evaluation
- Custom security restrictions