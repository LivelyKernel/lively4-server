import Service from './service.js';
import pty from 'node-pty';
import os from 'os';
import { exec } from 'child_process';
import { logRequest } from '../utils.js';

/**
 * Terminal service that provides PTY terminal creation and WebSocket connections
 * This service allows creating terminal sessions and connecting to them via WebSocket
 * @extends Service
 */
export default class TerminalService extends Service {

  constructor(server) {
    super(server);
    this.terminals = {};
    this.logs = {};
  }

  /**
   * Handle HTTP requests for terminal operations
   * @param {string} pathname - The request pathname
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Promise<void>}
   */
  async request(pathname, req, res) {
    // Check authentication
    if (!await this.server.authService.checkAuth(req, res)) {
      return;
    }

    if (pathname.match(/\/_terminal\/create/)) {
      return this.createTerminal(req, res);
    }

    if (pathname.match(/\/_terminal\/size\/(\d+)/)) {
      const pidMatch = pathname.match(/\/_terminal\/size\/(\d+)/);
      const pid = parseInt(pidMatch[1]);
      return this.resizeTerminal(pid, req, res);
    }

    if (pathname.match(/\/_terminal\/exec\/(\d+)/)) {
      const pidMatch = pathname.match(/\/_terminal\/exec\/(\d+)/);
      const pid = parseInt(pidMatch[1]);
      return this.executeCommand(pid, req, res);
    }

    if (pathname.match(/\/_terminal\/run/)) {
      return this.runCommand(req, res);
    }

    res.writeHead(404);
    res.end('Terminal endpoint not found');
  }

  /**
   * Create a new terminal session
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  createTerminal(req, res) {
    try {
      const shell = '/bin/bash';
      const args = [];
      const cols = parseInt(req.query.cols) || 80;
      const rows = parseInt(req.query.rows) || 24;
      let cwd = req.headers.cwd;

      // Handle relative paths from header - resolve them relative to /home/jens/lively4
      if (cwd && cwd.startsWith('/') && !cwd.startsWith('/home')) {
        cwd = `/home/jens/lively4${cwd}`;
      }

      // Fallback to environment if no header cwd provided
      if (!cwd) {
        cwd = process.env.PWD || process.cwd();
      }

      logRequest(req, `Creating terminal: ${cols}x${rows} in ${cwd}`);

      const term = pty.spawn(shell, args, {
        name: 'xterm-color',
        cols: cols,
        rows: rows,
        cwd: cwd,
        env: process.env
      });

      logRequest(req, `Created terminal with PID: ${term.pid}`);

      this.terminals[term.pid] = term;
      this.logs[term.pid] = '';

      // Buffer terminal output
      term.on('data', (data) => {
        this.logs[term.pid] += data;
      });

      // Clean up on terminal exit
      term.on('exit', (code, signal) => {
        logRequest(req, `Terminal ${term.pid} exited`);
        delete this.terminals[term.pid];
        delete this.logs[term.pid];
      });

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(term.pid.toString());

    } catch (error) {
      logRequest(req, `Error creating terminal: ${error.message}`);
      res.writeHead(500);
      res.end(`Error creating terminal: ${error.message}`);
    }
  }

  /**
   * Resize an existing terminal
   * @param {number} pid - Terminal process ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  resizeTerminal(pid, req, res) {
    try {
      const term = this.terminals[pid];
      if (!term) {
        res.writeHead(404);
        res.end('Terminal not found');
        return;
      }

      const cols = parseInt(req.query.cols) || 80;
      const rows = parseInt(req.query.rows) || 24;

      term.resize(cols, rows);
      logRequest(req, `Resized terminal ${pid} to ${cols}x${rows}`);

      res.writeHead(200);
      res.end();

    } catch (error) {
      logRequest(req, `Error resizing terminal ${pid}: ${error.message}`);
      res.writeHead(500);
      res.end(`Error resizing terminal: ${error.message}`);
    }
  }

  /**
   * Execute a command in an existing terminal and return the result
   * @param {number} pid - Terminal process ID
   * @param {Object} req - Express request object with command in body
   * @param {Object} res - Express response object
   */
  async executeCommand(pid, req, res) {
    console.log("executeCommand")
    try {
      const term = this.terminals[pid];
      if (!term) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Terminal not found' }));
        return;
      }

      // Express middleware has already parsed the JSON body
      const { command } = req.body || {};
      
      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Command is required' }));
        return;
      }

      logRequest(req, `Executing command in terminal ${pid}: ${command}`);

      // Execute command and capture output
      const result = await this.captureCommandOutput(term, command, pid);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      logRequest(req, `Error executing command: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Error executing command: ${error.message}` }));
    }
  }

  /**
   * Execute a command non-interactively without requiring a terminal session
   * @param {Object} req - Express request object with command in body
   * @param {Object} res - Express response object
   */
  async runCommand(req, res) {
    try {
      // Express middleware has already parsed the JSON body
      const { command } = req.body || {};
      
      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Command is required' }));
        return;
      }

      logRequest(req, `Running command: ${command}`);

      // Execute command using the non-interactive run method
      const result = await this.run(command);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      logRequest(req, `Error running command: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Error running command: ${error.message}` }));
    }
  }

  /**
   * Capture output from a command execution
   * @param {Object} term - PTY terminal instance
   * @param {string} command - Command to execute
   * @param {number} pid - Terminal PID for logging
   * @returns {Promise<Object>} Command result with output, exitCode, duration
   */
  async captureCommandOutput(term, command, pid) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let outputBuffer = '';
      let promptPattern = /[\$#>]\s*$/; // Basic prompt detection
      let timeoutId;

      // Capture output
      const onData = (data) => {
        outputBuffer += data;
        this.logs[pid] += data; // Keep adding to main log

        // Reset timeout on new data
        if (timeoutId) clearTimeout(timeoutId);

        // Check for command completion (prompt pattern)
        if (promptPattern.test(outputBuffer)) {
          cleanup();
          resolve({
            output: outputBuffer,
            exitCode: 0, // We can't easily get real exit code from PTY
            duration: Date.now() - startTime,
            finished: true
          });
          return;
        }

        // Set timeout for command completion
        timeoutId = setTimeout(() => {
          cleanup();
          resolve({
            output: outputBuffer,
            exitCode: -1, // Timeout indicator
            duration: Date.now() - startTime,
            finished: false,
            timeout: true
          });
        }, 5000); // 5 second timeout
      };

      const cleanup = () => {
        term.removeListener('data', onData);
        if (timeoutId) clearTimeout(timeoutId);
      };

      // Start listening for output
      term.on('data', onData);

      // Send command with newline
      const cmd = command.endsWith('\n') ? command : command + '\n';
      term.write(cmd);
    });
  }

  /**
   * Handle WebSocket connections to terminals
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} req - Express request object with terminal PID in params
   */
  async handleWebSocket(ws, req) {
    // Extract PID from URL path
    const pidMatch = req.url.match(/\/_terminal\/ws\/(\d+)/);
    if (!pidMatch) {
      ws.close(1008, 'Invalid terminal PID');
      return;
    }

    const pid = parseInt(pidMatch[1]);
    const term = this.terminals[pid];

    if (!term) {
      ws.close(1008, 'Terminal not found');
      return;
    }

    console.log(`[Terminal] WebSocket connected to terminal ${pid}`);

    // Send buffered output to new connection
    if (this.logs[pid]) {
      ws.send(this.logs[pid]);
    }

    // Buffer WebSocket sends to improve performance
    const buffer = this.createBuffer(ws, 5);

    // Forward terminal output to WebSocket
    const onData = (data) => {
      try {
        buffer(data);
      } catch (ex) {
        // WebSocket is closed, ignore
      }
    };

    term.on('data', onData);

    // Forward WebSocket input to terminal
    ws.on('message', (msg) => {
      try {
        term.write(msg.toString());
      } catch (ex) {
        console.log(`[Terminal] Error writing to terminal ${pid}:`, ex.message);
      }
    });

    // Clean up on WebSocket close
    ws.on('close', () => {
      console.log(`[Terminal] WebSocket disconnected from terminal ${pid}`);
      term.removeListener('data', onData);

      // Kill terminal when WebSocket closes
      try {
        term.kill();
        console.log(`[Terminal] Killed terminal ${pid}`);
      } catch (ex) {
        console.log(`[Terminal] Error killing terminal ${pid}:`, ex.message);
      }

      // Clean up
      delete this.terminals[pid];
      delete this.logs[pid];
    });

    // Handle WebSocket errors
    ws.on('error', (error) => {
      console.log(`[Terminal] WebSocket error for terminal ${pid}:`, error.message);
    });
  }

  /**
   * Create a buffered send function for WebSocket to improve performance
   * @param {WebSocket} socket - WebSocket connection
   * @param {number} timeout - Buffer timeout in milliseconds
   * @returns {Function} Buffered send function
   */
  createBuffer(socket, timeout) {
    let buffer = '';
    let sender = null;

    return (data) => {
      buffer += data;
      if (!sender) {
        sender = setTimeout(() => {
          if (socket.readyState === socket.OPEN) {
            socket.send(buffer);
          }
          buffer = '';
          sender = null;
        }, timeout);
      }
    };
  }

  /**
   * Execute a command non-interactively using child_process.exec
   * @param {string} cmd - Command to execute
   * @returns {Promise<Object>} Promise resolving to {stdout, stderr, error}
   */
  async run(cmd) {
    return new Promise((resolve) => {
      // Use same large buffer size as utils.js
      exec(cmd, { maxBuffer: 1024 * 2000 * 100 }, (error, stdout, stderr) => {
        resolve({ stdout, stderr, error });
      });
    });
  }

  /**
   * Get status information about active terminals
   * @returns {Object} Status information
   */
  getStatus() {
    const activeTerminals = Object.keys(this.terminals).length;
    const terminalInfo = Object.keys(this.terminals).map(pid => ({
      pid: parseInt(pid),
      logSize: this.logs[pid] ? this.logs[pid].length : 0
    }));

    return {
      activeTerminals,
      terminals: terminalInfo
    };
  }

  /**
   * Clean up all terminals and resources
   */
  cleanup() {
    for (const pid of Object.keys(this.terminals)) {
      try {
        this.terminals[pid].kill();
      } catch (ex) {
        // Terminal already closed
      }
    }

    this.terminals = {};
    this.logs = {};
  }
}