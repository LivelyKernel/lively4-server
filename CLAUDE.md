# Lively4 Server Project

This is the Node.js server that serves Lively4. It reads and writes files, makes commits, caches transpiled modules, and serves them back as bundles if needed.

## Project Structure

- `src/` - Main source code
  - `http-server.js` - Main server entry point
  - `services/` - HTTP service handlers (auth, files, search, terminal, etc.)
  - `utils.js` - Utility functions
- `bin/` - Configuration scripts with sample setups
- `test/` - Test files using Mocha
- `docs/` - JSDoc generated documentation

## Key Commands

- **Start server**: Use configuration scripts in `bin/` (e.g., `bin/lively4S1.sh`)
- **Run tests**: `npm test` (uses Mocha)
- **Generate docs**: `npm run docs` (JSDoc)

## Technology Stack

- Node.js with ES modules (`"type": "module"`)
- Express.js for HTTP server
- WebSocket support via express-ws
- PTY terminal support via node-pty
- Testing: Mocha + Chai
- Documentation: JSDoc

## Development Notes

- Server uses self-supporting development with two instances (stable/dev)
- Automatically restarts on errors
- Supports various HTTP services for file operations and terminal access
- JSDoc guidelines available in `docs/jsdoc_guidelines.md`
- Terminal service provides secure PTY access with GitHub authentication

## Configuration

- Use scripts in `bin/` directory for different deployment scenarios
- `lively4S1.sh` - Stable server (auto-pull from git)
- `lively4S2.sh` - Development server (no auto-pull)
- Manual configuration: `--port=8080 --directory=../path`

## Services

### Terminal Service
- **Endpoints**: `/_terminal/create`, `/_terminal/size/:pid`
- **WebSocket**: `/_terminal/ws/:pid` for real-time terminal I/O
- **Authentication**: GitHub OAuth required (same as other services)
- **Documentation**: See `docs/terminal.md` for detailed API usage

### File Services  
- Standard HTTP methods (GET, PUT, DELETE, MOVE, MKCOL, OPTIONS)
- File watching via WebSocket at `/_filewatch`
- Git operations, search, bundling, and more

## Documentation & Changes

- **Changelog**: See `CHANGELOG.md` for recent changes and improvements
- **API Documentation**: Generated docs available in `docs/` directory
- **Terminal API**: Detailed documentation in `docs/terminal.md`
- When making significant changes, update the changelog with date-based entries