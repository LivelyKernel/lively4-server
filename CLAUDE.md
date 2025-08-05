# Lively4 Server Project

This is the Node.js server that serves Lively4. It reads and writes files, makes commits, caches transpiled modules, and serves them back as bundles if needed.

## Project Structure

- `src/` - Main source code
  - `http-server.js` - Main server entry point
  - `services/` - HTTP service handlers (auth, files, search, etc.)
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
- Testing: Mocha + Chai
- Documentation: JSDoc

## Development Notes

- Server uses self-supporting development with two instances (stable/dev)
- Automatically restarts on errors
- Supports various HTTP services for file operations
- JSDoc guidelines available in `docs/jsdoc_guidelines.md`

## Configuration

- Use scripts in `bin/` directory for different deployment scenarios
- `lively4S1.sh` - Stable server (auto-pull from git)
- `lively4S2.sh` - Development server (no auto-pull)
- Manual configuration: `--port=8080 --directory=../path`