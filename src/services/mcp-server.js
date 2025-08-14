import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { log } from '../utils.js';

/**
 * MCP (Model Context Protocol) Server for Lively4
 * 
 * Provides a standard MCP interface for Claude Code to interact with live Lively4 environments.
 * Uses McpSessionService to route requests to specific browser sessions.
 */
class Lively4McpServer {
  constructor(mcpSessionService) {
    this.mcpSessionService = mcpSessionService;
    this.mcpServer = null;
    this.transport = null;
    this.isRunning = false;
  }

  /**
   * Initialize and start the MCP server
   * @param {Object} options - Server options
   * @param {string} options.transport - Transport type ('stdio' or 'http')
   * @param {Object} options.app - Express app instance for HTTP integration
   */
  async start(options = { transport: 'stdio' }) {
    try {
      // Create MCP server instance
      this.mcpServer = new McpServer(
        {
          name: 'lively4-mcp-server',
          version: '1.0.0',
          description: 'MCP server for live Lively4 development environment interaction'
        },
        {
          capabilities: {
            tools: {},
            logging: {}
          }
        }
      );

      // Register tools
      this.registerTools();

      // Set up transport based on options
      if (options.transport === 'http' && options.app) {
        await this.setupHttpTransport(options.app);
        log(`[MCP Server] HTTP transport integrated with main server`);
      } else {
        this.transport = new StdioServerTransport();
        log('[MCP Server] Starting with stdio transport');
        // Connect server to transport
        await this.mcpServer.connect(this.transport);
      }
      
      this.isRunning = true;
      log('[MCP Server] MCP server started successfully');
      
      return true;
    } catch (error) {
      log(`[MCP Server] Failed to start: ${error.message}`);
      log(`[MCP Server] Error stack: ${error.stack}`);
      throw error;
    }
  }

  /**
   * Set up HTTP transport integrated with Express app
   * @param {Object} app - Express app instance
   */
  async setupHttpTransport(app) {
    const transports = {}; // Session ID -> transport mapping
    const { randomUUID } = await import('node:crypto');
    const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

    // MCP POST handler
    const mcpPostHandler = async (req, res) => {
      try {
        log(`[MCP Server] Received request: ${req.body.method || 'unknown'}`);
        const sessionId = req.headers['mcp-session-id'];
        let transport = transports[sessionId];

        log(`[MCP Server] Session ID: ${sessionId}, Transport exists: ${!!transport}`);
        log(`[MCP Server] Is initialize request: ${isInitializeRequest(req.body)}`);

        if (!transport && isInitializeRequest(req.body)) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onSessionInitialized: (sessionId) => {
              log(`[MCP Server] HTTP session initialized: ${sessionId}`);
              transports[sessionId] = transport;
            }
          });

          // Set up cleanup on close
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              log(`[MCP Server] HTTP session closed: ${sid}`);
              delete transports[sid];
            }
          };

          // Connect to MCP server
          await this.mcpServer.connect(transport);
        }

        if (!transport) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32602, message: 'Invalid session or missing initialization' },
            id: req.body.id || null
          });
          return;
        }

        // Handle the request
        await transport.handleRequest(req, res);
      } catch (error) {
        log(`[MCP Server] HTTP handler error: ${error.message}`);
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: req.body.id || null
        });
      }
    };

    // Add MCP routes to the app
    app.post('/_mcp/message', mcpPostHandler);
    
    log('[MCP Server] HTTP routes added: POST /_mcp/message');
    return true;
  }

  /**
   * Register MCP tools with the server
   */
  registerTools() {
    // Tool: evaluate_code - Execute JavaScript in a specific Lively4 session
    this.mcpServer.tool(
      'evaluate_code',
      'Execute JavaScript code in a specific Lively4 browser session',
      {
        sessionId: z.string().describe('Target Lively4 session ID (get from list_sessions)'),
        code: z.string().describe('JavaScript code to evaluate in the live environment'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)')
      },
      async ({ sessionId, code, timeout = 30000 }) => {
        log(`[MCP Server] Evaluate code in session ${sessionId}: ${code.substring(0, 50)}...`);
        return await this.handleEvaluateCode({ sessionId, code, timeout });
      }
    );

    // Tool: list_sessions - List all active sessions
    this.mcpServer.tool(
      'list_sessions',
      'List all active Lively4 browser sessions available for code execution',
      {},
      async () => {
        log(`[MCP Server] Listing active sessions`);
        return await this.handleListSessions({});
      }
    );

    // Tool: ping_sessions - Ping all sessions
    this.mcpServer.tool(
      'ping_sessions',
      'Ping all active sessions to check connectivity',
      {},
      async () => {
        log(`[MCP Server] Pinging all sessions`);
        return await this.handlePingSessions({});
      }
    );

    log('[MCP Server] Tools registered: evaluate_code, list_sessions, ping_sessions');
  }

  /**
   * Handle evaluate_code tool call
   * @param {Object} args - Tool arguments
   * @returns {Object} Tool result
   */
  async handleEvaluateCode(args) {
    const { sessionId, code, timeout = 30000 } = args;

    if (!sessionId) {
      return {
        content: [{
          type: 'text',
          text: 'Error: sessionId is required'
        }],
        isError: true
      };
    }

    if (!code) {
      return {
        content: [{
          type: 'text',
          text: 'Error: code is required'
        }],
        isError: true
      };
    }

    try {
      log(`[MCP Server] Evaluating code in session ${sessionId}`);
      const result = await this.mcpSessionService.evaluateCode(sessionId, code, timeout);
      
      return {
        content: [{
          type: 'text',
          text: `Evaluation successful in ${result.duration}ms:\n\n${result.result}`
        }],
        isError: false
      };
      
    } catch (error) {
      log(`[MCP Server] Code evaluation failed: ${error.message}`);
      
      return {
        content: [{
          type: 'text',
          text: `Code evaluation failed: ${error.message}`
        }],
        isError: true
      };
    }
  }

  /**
   * Handle list_sessions tool call
   * @param {Object} args - Tool arguments  
   * @returns {Object} Tool result
   */
  async handleListSessions(args) {
    try {
      const sessions = this.mcpSessionService.getActiveSessions();
      
      if (sessions.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No active Lively4 sessions found. Make sure a lively-mcp component is running in a browser.'
          }],
          isError: false
        };
      }

      const sessionList = sessions.map(session => 
        `Session ID: ${session.sessionId}\n` +
        `Registered: ${session.registeredAt}\n` +
        `Connected: ${session.connected}\n` +
        `User Agent: ${session.userAgent}\n`
      ).join('\n---\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${sessions.length} active Lively4 session(s):\n\n${sessionList}`
        }],
        isError: false
      };
      
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Failed to list sessions: ${error.message}`
        }],
        isError: true
      };
    }
  }

  /**
   * Handle ping_sessions tool call
   * @param {Object} args - Tool arguments
   * @returns {Object} Tool result  
   */
  async handlePingSessions(args) {
    try {
      const pingCount = this.mcpSessionService.pingAllSessions();
      const totalSessions = this.mcpSessionService.sessions.size;
      
      return {
        content: [{
          type: 'text',
          text: `Pinged ${pingCount}/${totalSessions} sessions successfully`
        }],
        isError: false
      };
      
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Failed to ping sessions: ${error.message}`
        }],
        isError: true
      };
    }
  }

  /**
   * Stop the MCP server
   */
  async stop() {
    if (this.isRunning && this.mcpServer) {
      try {
        await this.mcpServer.close();
        this.isRunning = false;
        log('[MCP Server] MCP server stopped');
      } catch (error) {
        log(`[MCP Server] Error stopping server: ${error.message}`);
      }
    }
  }

  /**
   * Get server status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      transportType: this.transport?.constructor?.name || 'none',
      sessionServiceStatus: this.mcpSessionService.getStatus()
    };
  }
}

export default Lively4McpServer;