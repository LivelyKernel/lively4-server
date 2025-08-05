# lively4-server
The way to serve Lively4. Reads and writes files, makes commits, caches transpiled modules, and serves them back as bundles if needed.

For development notes and project structure, see [CLAUDE.md](CLAUDE.md).

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

The recommended way to start the server is using the configuration scripts in the `bin/` directory:

```bash
# Example configurations with different setups:
bin/lively4S1.sh   # Stable server (port 9005, auto-pull from git)
bin/lively4S2.sh   # Development server (port 9006, no auto-pull)
```

These scripts contain sample configurations that set up:
- Server and Lively4 directory paths
- Port numbers
- Git pull behavior
- Auto-commit settings
- URL configuration

### Manual Configuration

You can also start the server directly with custom options:
```
node src/http-server.js --port=8080 --directory=../foo/bar
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


