# Changelog

All notable changes to this project will be documented in this file.

---

## [2025-08-15] - MCP Tool Framework Refactoring

### Changed — MCP Architecture

- **Refactored MCP tool system** to separate meta tools from Lively-specific tools
- Moved tool definitions from hardcoded server logic to configurable `tools.json`
- Created hybrid approach: meta tools (server-side) vs. lively tools (browser-side)
- Enhanced tool registration system with automatic type-based routing

### Added — Generic Tool Framework

- New `tools.json` configuration file with tool type classification (`meta` vs `lively`)
- Generic `handleLivelyToolCall()` method in McpSessionService for browser-bound tools
- `handleGenericLivelyTool()` method in MCP server for tool-agnostic request handling
- Enhanced browser client with dynamic tool handler discovery pattern
- Support for both `evaluation-result` and `tool-result` message types

### Enhanced — Browser Integration

- Updated `lively-mcp` component with generic `handleToolExecution()` method
- Automatic handler method discovery: `handle{ToolName}Tool()` pattern
- Enhanced display logic for different tool types with backward compatibility
- Improved error handling and logging for generic tool operations

### Technical Benefits

- **Extensibility**: New Lively tools only require JSON config + browser handler
- **Separation of Concerns**: Server handles infrastructure, browser handles application logic
- **Backward Compatibility**: All existing code continues to work unchanged
- **Developer Experience**: Easy tool addition without server-side code changes

---

## [2025-08-14] - Complete MCP Integration Implementation

### Added — MCP Protocol Support

- **Full MCP server implementation** with manual protocol handling (no SDK dependencies)
- HTTP transport integration with JSON-RPC 2.0 message handling
- Session management service with WebSocket-based browser communication
- Three core MCP tools: `evaluate_code`, `list_sessions`, `ping_sessions`

### Added — Browser MCP Agent

- New `lively-mcp` component for in-browser MCP session management
- Real-time WebSocket connection to server with auto-reconnection
- JavaScript code evaluation using SystemJS and eval() with proper error handling
- Session registration with UUID-based isolation for multi-user support

### Added — Session Architecture

- Dual-connection design: Browser ↔ Server (WebSocket) + Claude Code ↔ Server (MCP)
- Request/response correlation with unique request IDs and timeout protection
- Activity logging and status monitoring for debugging and transparency
- Connection health monitoring with ping/pong keep-alive mechanism

### Technical Implementation

- HTTP endpoints: `/_mcp/message` (JSON-RPC), `/_mcp-session` (WebSocket)
- MCP protocol validation with proper error responses and status codes
- Session service integration with main HTTP server and Express middleware
- Comprehensive documentation in `MCP_INTEGRATION.md`

---

## [2025-08-13] - Terminal Working Directory Support & Command Execution API

### Added — Terminal Service

- Support for custom working directory via `cwd` header in terminal creation
- Automatic path resolution for relative paths starting with `/` to `/home/jens/lively4` base
- Enhanced terminal session initialization with proper directory support
- **HTTP Command Execution API**: New `/_terminal/exec/{pid}` endpoint for programmatic command execution
- Command output capture with prompt detection and timeout handling
- Structured JSON response with output, exit status, duration, and completion status

### Changed — Terminal Integration

- Modified `createTerminal()` to process `cwd` header and resolve relative paths
- Improved terminal startup reliability with proper filesystem path handling
- Better separation between header-provided paths and system defaults
- **Enhanced WebSocket Integration**: Commands executed via HTTP API also appear in live terminal streams
- Added `captureCommandOutput()` method with Promise-based command tracking

### Technical Implementation

- HTTP endpoint accepts JSON `{ "command": "ls -la" }` and returns structured results
- Prompt pattern detection (`[\$#>]\s*$`) for command completion
- 5-second timeout with graceful handling for long-running commands
- Dual output streams: captured results + live WebSocket display
- Proper cleanup of event listeners and timeouts

---

## [2025-08-12] - Git Sync Event Notifications

### Added — File Watching

- New `SYNC` event type in FileWatchService for git metadata changes
- `broadcastGitSyncEvent()` method to notify clients of git status changes
- Git status tracking in GIT service before/after sync operations
- Real-time notifications when files change from uncommitted/unpushed to clean state
- Helper methods `getGitStatusFiles()`, `parseGitStatus()`, and `findSyncedFiles()`
- Comprehensive test coverage for git sync event functionality

### Changed — Git Integration

- Enhanced `/_git/sync` endpoint to detect and broadcast git status changes
- Integration between GIT service and FileWatchService for cross-editor notifications
- Git status parsing to handle `git status --porcelain` output correctly

---

## [2025-08-11] - Documentation Updates

### Changed — Docs

- Updated project documentation and guides

---

## [2025-08-08] - Terminal Service with WebSocket Support

### Added — Terminal

- New Terminal service providing PTY-backed terminal sessions
- HTTP endpoint to create terminals: `/_terminal/create`
- HTTP endpoint to set terminal size: `/_terminal/size/:pid`
- WebSocket endpoint to attach to a terminal: `/_terminal/ws/:pid`
- Basic session management and authentication checks for terminal connections
- Initial test coverage for terminal service

---

## [2025-08-07] - File Watcher Auto-Recovery

### Fixed

- **Critical**: File watcher no longer stops working after Claude Code edits files
- Added automatic detection and recovery from atomic file operations (temp file + rename pattern)

### Added

- New diagnostic endpoint: `/_filewatch/validate` for watcher health checks
- Enhanced logging for file watcher events and successful client notifications
- Comprehensive test coverage for atomic file operations

---

## [2025-08-06] - File Watcher Improvements & Event Deduplication

### Added

- Comprehensive dotfile filtering in file watcher service
- Event deduplication system to prevent duplicate file change notifications
- Enhanced test coverage for file watching functionality

### Fixed

- File deletion events now correctly show as "DELETE" instead of "RENAME"
- Duplicate change notifications eliminated within 50ms time window
- Improved event type detection logic for filesystem operations

### Changed

- File watcher now ignores all files starting with "." (dotfiles)
- Simplified operation type determination algorithm
- Enhanced file existence cache management

---

## [2025-08-05] - Initial File Watching Service

### Added — File Watch

- Implemented file watching service and initial tests
- Introduced WebSocket-based file watch endpoint
- Added on-demand path watching and a system limits endpoint
- Enhanced `bin/watch.sh` to monitor all JavaScript files
- Added contributor documentation and README updates

---

## Previous Changes

*This changelog was created on 2025-08-06. Previous changes were not documented.*
