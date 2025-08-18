import fetch from 'node-fetch';
import { expect } from 'chai';
import WebSocket from 'ws';
import { Server } from '../../src/http-server.js';

describe("Terminal Service", () => {
  var port = 8082;
  var url = `http://localhost:${port}`;
  var server;

  before(async function () {
    this.timeout(10000);
    server = new Server();
    server.setup();
    server.lively4dir = 'test/tmp/';
    server.port = port;
    server.options['authorize-requests'] = false; // Disable auth for tests

    // Start server
    Promise.resolve().then(() => {
      server.start();
    });
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe("Terminal Creation", () => {
    it("should create a new terminal and return PID", async () => {
      const response = await fetch(`${url}/_terminal/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        }
      });

      expect(response.status).to.equal(200);
      const pid = await response.text();
      expect(pid).to.match(/^\d+$/); // Should be a number (PID)
    });

    it("should require authentication when auth is enabled", async () => {
      // Temporarily enable auth
      server.options['authorize-requests'] = true;
      server.options['github-organization'] = 'testorg';
      server.options['github-team'] = 'testteam';

      const response = await fetch(`${url}/_terminal/create`, {
        method: 'POST'
      });

      expect(response.status).to.equal(403);

      // Restore auth settings
      server.options['authorize-requests'] = false;
    });
  });

  describe("Terminal Resizing", () => {
    let terminalPid;

    beforeEach(async () => {
      const response = await fetch(`${url}/_terminal/create?cols=80&rows=24`, {
        method: 'POST',
        headers: {
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        }
      });
      terminalPid = await response.text();
    });

    it("should resize terminal dimensions", async () => {
      const response = await fetch(`${url}/_terminal/size/${terminalPid}?cols=120&rows=30`, {
        method: 'POST',
        headers: {
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        }
      });

      expect(response.status).to.equal(200);
    });
  });

  describe("Terminal Command Execution", () => {
    let terminalPid;

    beforeEach(async () => {
      const response = await fetch(`${url}/_terminal/create`, {
        method: 'POST',
        headers: {
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        }
      });
      terminalPid = await response.text();
    });

    it("should execute a simple command and return output", async () => {
      const response = await fetch(`${url}/_terminal/exec/${terminalPid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'echo "test command"' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      expect(result).to.have.property('output');
      expect(result).to.have.property('exitCode');
      expect(result).to.have.property('duration');
      expect(result).to.have.property('finished');
      expect(result.output).to.include('test command');
    });

    it("should handle command with no output", async () => {
      const response = await fetch(`${url}/_terminal/exec/${terminalPid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'true' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();
      expect(result).to.have.property('output');
      expect(result).to.have.property('finished');
    });

    it("should return error for invalid terminal PID", async () => {
      const response = await fetch(`${url}/_terminal/exec/99999`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'echo "test"' })
      });

      expect(response.status).to.equal(404);
      const result = await response.json();
      expect(result).to.have.property('error');
      expect(result.error).to.equal('Terminal not found');
    });

    it("should return error for missing command", async () => {
      const response = await fetch(`${url}/_terminal/exec/${terminalPid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({})
      });

      expect(response.status).to.equal(400);
      const result = await response.json();
      expect(result).to.have.property('error');
      expect(result.error).to.equal('Command is required');
    });

    it("should return error for invalid JSON", async () => {
      const response = await fetch(`${url}/_terminal/exec/${terminalPid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: 'invalid json'
      });

      expect(response.status).to.equal(400);
      const result = await response.json();
      expect(result).to.have.property('error');
      expect(result.error).to.equal('Invalid JSON in request body');
    });

    xit("should handle long running commands with timeout", async function () {
      this.timeout(8000); // Extend test timeout

      const response = await fetch(`${url}/_terminal/exec/${terminalPid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'sleep 10' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      expect(result).to.have.property('timeout');
      expect(result.timeout).to.equal(true);
      expect(result.finished).to.equal(false);
    });
  });

  describe("Non-Interactive Run Command", () => {
    it("should execute a simple command and return stdout/stderr", async () => {
      const response = await fetch(`${url}/_terminal/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'echo "hello world"' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      expect(result).to.have.property('stdout');
      expect(result).to.have.property('stderr');
      expect(result).to.have.property('error');
      expect(result.stdout).to.include('hello world');
      expect(result.error).to.be.null;
    });

    it("should handle commands that produce stderr output", async () => {
      const response = await fetch(`${url}/_terminal/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'echo "error message" >&2' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      expect(result).to.have.property('stdout');
      expect(result).to.have.property('stderr');
      expect(result).to.have.property('error');
      expect(result.stderr).to.include('error message');
    });

    it("should handle commands with exit codes", async () => {
      const response = await fetch(`${url}/_terminal/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'exit 1' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      expect(result).to.have.property('stdout');
      expect(result).to.have.property('stderr');
      expect(result).to.have.property('error');
      expect(result.error).to.not.be.null;
      expect(result.error.code).to.equal(1);
    });

    it("should return error for missing command", async () => {
      const response = await fetch(`${url}/_terminal/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({})
      });

      expect(response.status).to.equal(400);
      const result = await response.json();
      expect(result).to.have.property('error');
      expect(result.error).to.equal('Command is required');
    });

    it("should handle complex commands with pipes", async () => {
      const response = await fetch(`${url}/_terminal/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'echo "line1\nline2\nline3" | grep "line2"' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      expect(result).to.have.property('stdout');
      expect(result.stdout).to.include('line2');
      expect(result.stdout).to.not.include('line1');
      expect(result.stdout).to.not.include('line3');
    });

    it("should work without requiring an existing terminal session", async () => {
      // This test verifies that run works independently of terminal creation
      const response = await fetch(`${url}/_terminal/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        },
        body: JSON.stringify({ command: 'pwd' })
      });

      expect(response.status).to.equal(200);
      const result = await response.json();

      expect(result).to.have.property('stdout');
      expect(result).to.have.property('stderr');
      expect(result).to.have.property('error');
      expect(result.stdout).to.be.a('string');
    });
  });

  describe("WebSocket Terminal Connection", () => {
    let terminalPid;

    beforeEach(async () => {
      const response = await fetch(`${url}/_terminal/create`, {
        method: 'POST',
        headers: {
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        }
      });
      terminalPid = await response.text();
    });

    it("should establish WebSocket connection to terminal", (done) => {
      let completed = false;

      const ws = new WebSocket(`ws://localhost:${port}/_terminal/ws/${terminalPid}`, {
        headers: {
          'gitusername': 'testuser',
          'gitpassword': 'testtoken'
        }
      });

      const complete = (error) => {
        if (completed) return;
        completed = true;
        ws.close();
        done(error);
      };

      ws.on('open', () => {
        // Send a simple command
        ws.send('echo "hello terminal"\n');
      });

      ws.on('message', (data) => {
        const message = data.toString();
        if (message.includes('hello terminal')) {
          complete();
        }
      });

      ws.on('error', (error) => {
        complete(error);
      });

      // Timeout after 3 seconds
      const timeout = setTimeout(() => {
        complete(new Error('WebSocket test timed out'));
      }, 3000);

      ws.on('close', () => {
        clearTimeout(timeout);
      });
    });
  });
});