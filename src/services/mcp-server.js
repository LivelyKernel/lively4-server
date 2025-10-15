import { log } from '../utils.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Manual MCP (Model Context Protocol) Server for Lively4
 * 
 * Implements the MCP specification directly without SDK dependencies.
 * Provides a standard MCP interface for Claude Code to interact with live Lively4 environments.
 */
class Lively4McpServer {
  constructor(mcpSessionService) {
    this.mcpSessionService = mcpSessionService;
    this.isRunning = false;
    this.sessions = new Map(); // sessionId -> session data
    this.tools = new Map(); // tool name -> tool handler
    this.capabilities = {
      tools: {},
      logging: {
        setLevel: true
      }
    };

    // Register our tools
    this.registerTools();
  }

  /**
   * Initialize and start the MCP server
   * @param {Object} options - Server options
   * @param {string} options.transport - Transport type (only 'http' supported)
   * @param {Object} options.app - Express app instance for HTTP integration
   */
  async start(options = { transport: 'http' }) {
    try {
      if (options.transport === 'http' && options.app) {
        this.setupHttpTransport(options.app);
        log(`[MCP Server] HTTP transport integrated with main server`);
      } else {
        throw new Error('Only HTTP transport is supported');
      }

      this.isRunning = true;
      log('[MCP Server] MCP server started successfully');

      return true;
    } catch (error) {
      log(`[MCP Server] Failed to start: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set up HTTP transport integrated with Express app
   * @param {Object} app - Express app instance
   */
  setupHttpTransport(app) {
    // MCP endpoint handler for POST requests (sending messages to server)
    const mcpPostHandler = async (req, res) => {
      try {
        // Validate Accept header as per spec
        // Note: We're relaxing the requirement to allow clients that only accept application/json
        const acceptHeader = req.headers.accept || '';
        if (!acceptHeader.includes('application/json') && !acceptHeader.includes('text/event-stream')) {
          return this.sendJsonRpcError(res, -32000, 'Not Acceptable: Client must accept application/json or text/event-stream', null);
        }

        // Validate protocol version header
        const protocolVersion = req.headers['mcp-protocol-version'];
        if (protocolVersion && protocolVersion !== '2025-06-18') {
          return this.sendJsonRpcError(res, -32000, `Unsupported protocol version: ${protocolVersion}`, null);
        }

        // Parse and validate JSON-RPC message
        const message = req.body;
        if (!this.isValidJsonRpcMessage(message)) {
          return this.sendJsonRpcError(res, -32700, 'Parse error: Invalid JSON-RPC message', null);
        }

        log(`[MCP Server] Received ${message.method || 'response'} (id: ${message.id})`);

        // Handle the message
        await this.handleMessage(message, req, res);

      } catch (error) {
        log(`[MCP Server] HTTP handler error: ${error.message}`);
        if (!res.headersSent) {
          this.sendJsonRpcError(res, -32603, 'Internal server error', req.body?.id || null);
        }
      }
    };

    // MCP endpoint handler for GET requests (SSE stream - optional)
    const mcpGetHandler = async (req, res) => {
      try {
        const acceptHeader = req.headers.accept || '';
        if (!acceptHeader.includes('text/event-stream')) {
          return res.status(405).send('Method Not Allowed: GET requires Accept: text/event-stream');
        }

        // For now, we'll return 405 as we don't implement server-initiated messages
        res.status(405).send('Method Not Allowed: Server-initiated messages not implemented');

      } catch (error) {
        log(`[MCP Server] GET handler error: ${error.message}`);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
        }
      }
    };

    // Add MCP routes to the app
    app.post('/_mcp/message', mcpPostHandler);
    app.get('/_mcp/message', mcpGetHandler);

    log('[MCP Server] HTTP routes added: POST and GET /_mcp/message');
  }

  /**
   * Validate JSON-RPC message format
   */
  isValidJsonRpcMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.jsonrpc !== '2.0') return false;

    // Must have either method (request/notification) or result/error (response)
    if (message.method) {
      // Request or notification
      return typeof message.method === 'string';
    } else {
      // Response - must have id and either result or error
      return (message.id !== undefined) && ('result' in message || 'error' in message);
    }
  }

  /**
   * Handle incoming JSON-RPC message
   */
  async handleMessage(message, req, res) {
    const { method, params, id } = message;

    // Handle different MCP methods
    switch (method) {
      case 'initialize':
        await this.handleInitialize(params, id, req, res);
        break;

      case 'notifications/initialized':
        await this.handleNotificationInitialized(params, res);
        break;

      case 'tools/list':
        await this.handleToolsList(params, id, res);
        break;

      case 'tools/call':
        await this.handleToolsCall(params, id, res);
        break;

      case 'logging/setLevel':
        await this.handleLoggingSetLevel(params, id, res);
        break;

      case 'ping':
        await this.handlePing(params, id, res);
        break;

      default:
        this.sendJsonRpcError(res, -32601, `Method not found: ${method}`, id);
    }
  }

  /**
   * Handle initialize request
   */
  async handleInitialize(params, id, req, res) {
    const { protocolVersion, capabilities, clientInfo } = params || {};

    // Validate protocol version
    if (protocolVersion !== '2025-06-18') {
      return this.sendJsonRpcError(res, -32602, 'Invalid protocol version', id);
    }

    // Generate session ID
    const sessionId = this.generateSessionId();

    // Store session info
    this.sessions.set(sessionId, {
      clientInfo: clientInfo || {},
      capabilities: capabilities || {},
      createdAt: new Date().toISOString()
    });

    log(`[MCP Server] Initialized session: ${sessionId}`);

    // Send successful response
    const response = {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: this.capabilities,
        serverInfo: {
          name: 'lively4-mcp-server',
          version: '1.0.0',
          description: 'MCP server for live Lively4 development environment interaction'
        }
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Mcp-Session-Id', sessionId);
    res.json(response);
  }

  /**
   * Handle notifications/initialized notification
   */
  async handleNotificationInitialized(params, res) {
    // This is a notification (no id), so we don't send a response
    // Just log that the client has finished initialization
    log(`[MCP Server] Client initialization complete`);

    // For notifications, we should return 204 No Content
    res.status(204).send();
  }

  /**
   * Handle logging/setLevel request
   */
  async handleLoggingSetLevel(params, id, res) {
    const { level } = params || {};

    // For now, we'll accept any logging level but don't actually change anything
    // Valid levels according to MCP spec: debug, info, notice, warning, error, critical, alert, emergency
    const validLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

    if (level && !validLevels.includes(level)) {
      return this.sendJsonRpcError(res, -32602, `Invalid logging level: ${level}. Valid levels: ${validLevels.join(', ')}`, id);
    }

    log(`[MCP Server] Logging level set to: ${level || 'info'}`);

    // Send successful response
    const response = {
      jsonrpc: '2.0',
      id,
      result: {}
    };

    res.setHeader('Content-Type', 'application/json');
    res.json(response);
  }

  /**
   * Handle tools/list request
   */
  async handleToolsList(params, id, res) {
    const tools = Array.from(this.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));

    const response = {
      jsonrpc: '2.0',
      id,
      result: {
        tools
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.json(response);
  }

  /**
   * Handle tools/call request
   */
  async handleToolsCall(params, id, res) {
    const { name, arguments: args } = params || {};

    if (!name || !this.tools.has(name)) {
      return this.sendJsonRpcError(res, -32602, `Unknown tool: ${name}`, id);
    }

    try {
      const tool = this.tools.get(name);
      const result = await tool.handler(args || {});

      const response = {
        jsonrpc: '2.0',
        id,
        result
      };

      res.setHeader('Content-Type', 'application/json');
      res.json(response);

    } catch (error) {
      log(`[MCP Server] Tool execution error: ${error.message}`);
      this.sendJsonRpcError(res, -32603, `Tool execution failed: ${error.message}`, id);
    }
  }

  /**
   * Handle ping request
   */
  async handlePing(params, id, res) {
    // Simple ping/pong response
    const response = {
      jsonrpc: '2.0',
      id,
      result: {
        pong: true,
        timestamp: new Date().toISOString()
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.json(response);
  }

  /**
   * Load tools configuration from tools.json
   */
  loadToolsConfig() {
    try {
      const toolsConfigPath = join(__dirname, '../../tools.json');
      const configData = readFileSync(toolsConfigPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      log(`[MCP Server] Failed to load tools.json: ${error.message}`);
      throw new Error(`Could not load tools configuration: ${error.message}`);
    }
  }

  /**
   * Register MCP tools from tools.json configuration
   */
  registerTools() {
    const config = this.loadToolsConfig();
    const toolNames = [];

    for (const [toolName, toolConfig] of Object.entries(config.tools)) {
      const { description, inputSchema, type } = toolConfig;
      
      if (type === 'meta') {
        // Meta tools: Use specific handler methods (server-side operations)
        const { handler } = toolConfig;
        if (!this[handler] || typeof this[handler] !== 'function') {
          log(`[MCP Server] Warning: Handler method '${handler}' not found for meta tool '${toolName}'`);
          continue;
        }

        this.tools.set(toolName, {
          description,
          inputSchema,
          handler: async (args) => {
            return await this[handler](args);
          }
        });
      } else if (type === 'lively') {
        // Lively tools: Use generic handler that forwards to browser
        const { messageType } = toolConfig;
        if (!messageType) {
          log(`[MCP Server] Warning: messageType missing for lively tool '${toolName}'`);
          continue;
        }

        this.tools.set(toolName, {
          description,
          inputSchema,
          handler: async (args) => {
            return await this.handleGenericLivelyTool(messageType, args);
          }
        });
      } else {
        log(`[MCP Server] Warning: Unknown tool type '${type}' for tool '${toolName}'`);
        continue;
      }

      toolNames.push(toolName);
    }

    log(`[MCP Server] Tools registered from tools.json: ${toolNames.join(', ')}`);
  }

  /**
   * Handle generic Lively tool call (routes to browser via session service)
   */
  async handleGenericLivelyTool(messageType, args) {
    let { sessionId, timeout = 30000 } = args;

    // Smart session selection if no sessionId provided
    if (!sessionId) {
      const sessions = this.mcpSessionService.getActiveSessions();
      
      if (sessions.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No active Lively4 sessions found. Please open a browser session by:\n1. Navigate to http://localhost:9005\n2. Right-click → Tools → MCP'
          }],
          isError: true
        };
      } else if (sessions.length === 1) {
        sessionId = sessions[0].sessionId;
        log(`[MCP Server] Auto-selected session: ${sessionId}`);
      } else {
        const sessionList = sessions.map(session =>
          `• ${session.sessionId.substring(0, 8)}... (${session.userAgent || 'Unknown browser'})`
        ).join('\n');
        
        return {
          content: [{
            type: 'text',
            text: `Multiple sessions available. Please specify sessionId parameter:\n\n${sessionList}\n\nOr use list_sessions tool to see full session details.`
          }],
          isError: true
        };
      }
    }

    try {
      log(`[MCP Server] Executing ${messageType} tool in session ${sessionId}`);
      const result = await this.mcpSessionService.handleLivelyToolCall(messageType, { ...args, sessionId }, timeout);

      const autoSelectedNote = args.sessionId ? '' : ` (auto-selected session ${sessionId.substring(0, 8)}...)`;
      
      return {
        content: [{
          type: 'text',
          text: `${messageType} successful in ${result.duration}ms${autoSelectedNote}:\n\n${result.result}`
        }],
        isError: false
      };

    } catch (error) {
      log(`[MCP Server] ${messageType} tool failed: ${error.message}`);

      return {
        content: [{
          type: 'text',
          text: `${messageType} tool failed: ${error.message}`
        }],
        isError: true
      };
    }
  }

  /**
   * Handle list_sessions tool call
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
   * Send JSON-RPC error response
   */
  sendJsonRpcError(res, code, message, id) {
    const errorResponse = {
      jsonrpc: '2.0',
      error: { code, message },
      id
    };

    res.status(400).json(errorResponse);
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId() {
    return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Stop the MCP server
   */
  async stop() {
    this.isRunning = false;
    this.sessions.clear();
    log('[MCP Server] MCP server stopped');
  }

  /**
   * Get server status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      transportType: 'Manual HTTP',
      sessionCount: this.sessions.size,
      toolCount: this.tools.size,
      sessions: Array.from(this.sessions.entries()).map(([id, session]) => ({
        sessionId: id,
        clientInfo: session.clientInfo,
        createdAt: session.createdAt
      })),
      sessionServiceStatus: this.mcpSessionService.getStatus()
    };
  }
}

export default Lively4McpServer;