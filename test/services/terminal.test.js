import fetch from 'node-fetch';
import { expect } from 'chai';
import WebSocket from 'ws';
import { Server } from '../../src/http-server.js';

describe("Terminal Service", () => {
  var port = 8082;
  var url = `http://localhost:${port}`;
  var server;

  before(async function() {
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