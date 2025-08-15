#!/usr/bin/env node

/**
 * Test MCP Client for Lively4 MCP Server
 * 
 * This demonstrates how Claude Code would interact with the Lively4 MCP server.
 * Run this after starting the lively4-server to test the MCP integration.
 */

import { spawn } from 'child_process';
import readline from 'readline';

async function testMcpClient() {
  console.log('🤖 Lively4 MCP Test Client');
  console.log('Testing MCP server integration...\n');

  // Spawn the lively4-server as MCP server via stdio
  const mcpProcess = spawn('node', ['src/http-server.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd()
  });

  let messageId = 1;

  // Helper function to send MCP requests
  function sendMcpRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id: messageId++,
        method: method,
        params: params
      };

      console.log(`📤 Sending: ${method}`);
      console.log(JSON.stringify(request, null, 2));

      mcpProcess.stdin.write(JSON.stringify(request) + '\n');

      // Set up one-time response handler
      const handleResponse = (data) => {
        try {
          const response = JSON.parse(data.toString().trim());
          if (response.id === request.id) {
            mcpProcess.stdout.removeListener('data', handleResponse);
            console.log(`📥 Response for ${method}:`);
            console.log(JSON.stringify(response, null, 2));
            console.log('');
            resolve(response);
          }
        } catch (error) {
          console.log(`Raw response: ${data.toString()}`);
        }
      };

      mcpProcess.stdout.on('data', handleResponse);

      // Timeout after 5 seconds
      setTimeout(() => {
        mcpProcess.stdout.removeListener('data', handleResponse);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, 5000);
    });
  }

  try {
    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('1️⃣ Testing initialization...');
    await sendMcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        sampling: {}
      },
      clientInfo: {
        name: 'lively4-mcp-test-client',
        version: '1.0.0'
      }
    });

    console.log('2️⃣ Testing tools list...');
    await sendMcpRequest('tools/list');

    console.log('3️⃣ Testing session list...');
    await sendMcpRequest('tools/call', {
      name: 'list_sessions',
      arguments: {}
    });

    console.log('4️⃣ Testing session ping...');
    await sendMcpRequest('tools/call', {
      name: 'ping_sessions', 
      arguments: {}
    });

    // Example code evaluation (will fail if no sessions)
    console.log('5️⃣ Testing code evaluation (will fail without active browser session)...');
    try {
      await sendMcpRequest('tools/call', {
        name: 'evaluate_code',
        arguments: {
          sessionId: 'test-session-id',
          code: '2 + 2'
        }
      });
    } catch (error) {
      console.log(`Expected failure: ${error.message}`);
    }

    console.log('✅ MCP client test completed!');
    console.log('\nTo test with a real browser session:');
    console.log('1. Open http://localhost:9006 in your browser');
    console.log('2. Run: lively.openComponentInWindow("lively-mcp")');
    console.log('3. Get the session ID from the component UI');
    console.log('4. Use that session ID in evaluate_code calls');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    mcpProcess.kill();
  }
}

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down test client...');
  process.exit(0);
});

testMcpClient().catch(console.error);