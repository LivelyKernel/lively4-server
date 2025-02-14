# lively4-server
Alternative to accessing GitHub directly

## Public Example Instances

- https://lively-kernel.org/lively4/
- https://lively-kernel.org/lively4S2/

# Setup

Install the dependencies:

```
cd lively4-server
npm install
```

## Running the Server

To start the server with default settings:
```
npm start
```

### Configuration Options

You can configure the server port and served directory using environment variables or command line arguments:
```
node src/httpServer.js --port=8080
```
or
```
node src/httpServer.js --port 8080 --directory=../foo/bar
```

# Development Workflow

## Self-supporting Development

We use two instances of lively4-server to evolve the system in a self-supporting way. Each server has its own checkout of the git repository and automatically restarts on errors.

### Server A (Stable)
- Pulls changes from GitHub before (re-)starting
- Provides stable environment for production use

### Server B (Development)
- Used for active development and testing
- Source can be changed from within lively4 and pushed to GitHub
- Changes can be tested without affecting the stable server

## Development / Deployment Cycles

This setup enables two different development cycles:

1. **Short Cycle (Server B)**
   - Make changes and test immediately
   - Server restarts automatically
   - Once stable, commit and push to GitHub

2. **Long Cycle (Server A)**
   - Pulls changes from GitHub on restart
   - Provides stable production environment
   - Auto-recovers by pulling fixes from GitHub


