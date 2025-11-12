import { log } from '../utils.js';

/**
 * MCP Session service that manages connections between Lively4 browser clients and MCP protocol handlers
 * 
 * Architecture:
 * - Browser clients connect via WebSocket to /_mcp-session
 * - Each session gets a unique ID for multi-user support
 * - MCP server can target specific sessions for code evaluation
 * - Handles bidirectional communication between Claude Code and live Lively4 environments
 */
class McpSessionService {
  constructor() {
    this.sessions = new Map(); // sessionId -> { ws: WebSocket, metadata: Object }
    this.clients = new Set(); // WebSocket connections
    this.requestQueue = new Map(); // requestId -> { sessionId, resolve, reject, timeout }
    this.defaultTimeout = 30000; // 30 seconds for code evaluation
    this.onSessionRegistered = null; // Callback when session registers
    this.onSessionDisconnected = null; // Callback when session disconnects
  }

  /**
   * Add a WebSocket client (browser connection)
   * @param {WebSocket} ws - WebSocket connection from browser
   */
  addClient(ws) {
    this.clients.add(ws);
    log(`[MCP Session] Browser client connected. Total clients: ${this.clients.size}`);

    ws.on('close', () => {
      this.removeClient(ws);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        log(`[MCP Session] Invalid message from client: ${error.message}`);
        this.sendToClient(ws, {
          type: 'error',
          message: 'Invalid JSON message format'
        });
      }
    });
  }

  /**
   * Remove a client and clean up their session
   * @param {WebSocket} ws - WebSocket connection to remove
   */
  removeClient(ws) {
    // Find and remove session for this client
    let sessionId = null;
    for (const [id, session] of this.sessions) {
      if (session.ws === ws) {
        sessionId = id;
        break;
      }
    }

    if (sessionId) {
      this.sessions.delete(sessionId);
      log(`[MCP Session] Removed session: ${sessionId}`);

      // Notify MCP server if callback registered
      if (this.onSessionDisconnected) {
        this.onSessionDisconnected(sessionId).catch(err => {
          log(`[MCP Session] Error in session disconnect callback: ${err.message}`);
        });
      }
    }

    this.clients.delete(ws);
    log(`[MCP Session] Browser client disconnected. Total clients: ${this.clients.size}`);
  }

  /**
   * Handle messages from browser WebSocket clients
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message object
   */
  handleClientMessage(ws, message) {
    switch (message.type) {
      case 'register-session':
        this.registerSession(ws, message.sessionId, message.metadata || {});
        break;
        
      case 'evaluation-result':
      case 'tool-result':
      case 'tool-discovery-result':
        this.handleToolResult(message);
        break;
        
      case 'pong':
        // Keep-alive response, just log it
        log(`[MCP Session] Pong from session: ${message.sessionId}`);
        break;
        
      default:
        log(`[MCP Session] Unknown message type: ${message.type}`);
        this.sendToClient(ws, {
          type: 'error',
          message: `Unknown message type: ${message.type}`
        });
    }
  }

  /**
   * Register a session with unique ID from browser
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} sessionId - Unique session identifier from browser
   * @param {Object} metadata - Additional session metadata
   */
  registerSession(ws, sessionId, metadata = {}) {
    if (!sessionId) {
      log(`[MCP Session] Registration attempted without session ID`);
      this.sendToClient(ws, {
        type: 'error',
        message: 'Session ID is required for registration'
      });
      return;
    }

    // Check for existing session with same ID
    if (this.sessions.has(sessionId)) {
      log(`[MCP Session] Session ID ${sessionId} already exists, replacing...`);
    }

    const sessionData = {
      ws,
      sessionId,
      metadata: {
        ...metadata,
        registeredAt: new Date().toISOString(),
        userAgent: ws.upgradeReq?.headers?.['user-agent'] || 'Unknown'
      }
    };

    this.sessions.set(sessionId, sessionData);
    
    log(`[MCP Session] Session registered: ${sessionId} (${this.sessions.size} total sessions)`);
    
    // Confirm registration to browser
    this.sendToClient(ws, {
      type: 'session-registered',
      sessionId,
      message: 'Session registered successfully'
    });

    // Notify MCP server if callback registered
    if (this.onSessionRegistered) {
      this.onSessionRegistered(sessionId).catch(err => {
        log(`[MCP Session] Error in session registration callback: ${err.message}`);
      });
    }
  }

  /**
   * Send a message to a specific WebSocket client
   * @param {WebSocket} ws - Target WebSocket connection
   * @param {Object} message - Message to send
   */
  sendToClient(ws, message) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
        return true;
      } else {
        log(`[MCP Session] Cannot send to client - WebSocket not open (state: ${ws.readyState})`);
        return false;
      }
    } catch (error) {
      log(`[MCP Session] Error sending message to client: ${error.message}`);
      return false;
    }
  }

  /**
   * Send code evaluation request to specific session
   * @param {string} sessionId - Target session ID
   * @param {string} code - JavaScript code to evaluate
   * @param {number} timeout - Timeout in milliseconds (optional)
   * @returns {Promise<Object>} Evaluation result
   */
  async evaluateCode(sessionId, code, timeout = this.defaultTimeout) {
    return await this.handleLivelyToolCall('evaluate-code', { sessionId, code }, timeout);
  }

  /**
   * Send generic Lively tool call to specific session
   * @param {string} messageType - Message type to send to browser
   * @param {Object} args - Arguments for the tool call
   * @param {number} timeout - Timeout in milliseconds (optional)
   * @returns {Promise<Object>} Tool execution result
   */
  async handleLivelyToolCall(messageType, args, timeout = this.defaultTimeout) {
    const { sessionId } = args;
    if (!sessionId) {
      throw new Error('sessionId is required for Lively tool calls');
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const requestId = generateUUID();
    const startTime = Date.now();

    // Create log message based on tool type
    let logMessage = `[MCP Session] Sending ${messageType} request to session ${sessionId}`;
    if (args.code) {
      logMessage += `: ${args.code.substring(0, 100)}${args.code.length > 100 ? '...' : ''}`;
    }
    log(logMessage);

    // Send tool request to browser
    const sent = this.sendToClient(session.ws, {
      type: messageType,
      requestId,
      ...args,
      timestamp: new Date().toISOString()
    });

    if (!sent) {
      throw new Error(`Could not send ${messageType} request to session: ${sessionId}`);
    }

    // Set up promise that waits for response
    return new Promise((resolve, reject) => {
      // Store request for response handling
      this.requestQueue.set(requestId, {
        sessionId,
        messageType,
        resolve,
        reject,
        startTime,
        args: JSON.stringify(args).substring(0, 200) // Store args snippet for logging
      });

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        if (this.requestQueue.has(requestId)) {
          this.requestQueue.delete(requestId);
          reject(new Error(`${messageType} timeout after ${timeout}ms`));
        }
      }, timeout);

      // Store timeout handle for cleanup
      this.requestQueue.get(requestId).timeoutHandle = timeoutHandle;
    });
  }

  /**
   * Discover available tools from a browser session
   * @param {string} sessionId - Target session ID
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Array>} Array of tool definitions
   */
  async discoverSessionTools(sessionId, timeout = 5000) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const requestId = generateUUID();
    log(`[MCP Session] Discovering tools from session ${sessionId}`);

    // Send discovery request to browser
    const sent = this.sendToClient(session.ws, {
      type: 'discover-tools',
      requestId,
      timestamp: new Date().toISOString()
    });

    if (!sent) {
      throw new Error(`Could not send tool discovery request to session: ${sessionId}`);
    }

    // Wait for response
    return new Promise((resolve, reject) => {
      this.requestQueue.set(requestId, {
        sessionId,
        messageType: 'discover-tools',
        resolve: (response) => resolve(response.result.tools),
        reject,
        startTime: Date.now()
      });

      const timeoutHandle = setTimeout(() => {
        if (this.requestQueue.has(requestId)) {
          this.requestQueue.delete(requestId);
          reject(new Error(`Tool discovery timeout after ${timeout}ms`));
        }
      }, timeout);

      this.requestQueue.get(requestId).timeoutHandle = timeoutHandle;
    });
  }

  /**
   * Handle tool result from browser (generic for all tool types)
   * @param {Object} message - Result message from browser
   */
  handleToolResult(message) {
    const { requestId, success, result, sessionId } = message;
    
    const request = this.requestQueue.get(requestId);
    if (!request) {
      log(`[MCP Session] Received result for unknown request: ${requestId}`);
      return;
    }

    // Clear timeout
    if (request.timeoutHandle) {
      clearTimeout(request.timeoutHandle);
    }

    // Remove from queue
    this.requestQueue.delete(requestId);

    const duration = Date.now() - request.startTime;
    const toolType = request.messageType || 'tool';
    
    if (success) {
      let resultPreview;
      if (typeof result === 'string') {
        resultPreview = result.substring(0, 100) + (result.length > 100 ? '...' : '');
      } else if (result === undefined || result === null) {
        resultPreview = String(result);
      } else {
        const jsonStr = JSON.stringify(result);
        resultPreview = jsonStr ? jsonStr.substring(0, 100) : 'undefined';
      }
      log(`[MCP Session] ${toolType} success in ${duration}ms for session ${sessionId}: ${resultPreview}`);
      request.resolve({
        success: true,
        result,
        duration,
        sessionId
      });
    } else {
      log(`[MCP Session] ${toolType} error in ${duration}ms for session ${sessionId}: ${result}`);
      request.reject(new Error(result));
    }
  }

  /**
   * Handle evaluation result from browser (legacy compatibility)
   * @param {Object} message - Result message from browser
   */
  handleEvaluationResult(message) {
    return this.handleToolResult(message);
  }

  /**
   * Get list of active sessions
   * @returns {Array} Array of session information
   */
  getActiveSessions() {
    const sessions = [];
    for (const [sessionId, session] of this.sessions) {
      sessions.push({
        sessionId,
        registeredAt: session.metadata.registeredAt,
        userAgent: session.metadata.userAgent,
        connected: session.ws.readyState === session.ws.OPEN
      });
    }
    return sessions;
  }

  /**
   * Send ping to all sessions to check connectivity
   */
  pingAllSessions() {
    const timestamp = new Date().toISOString();
    let sentCount = 0;
    
    for (const [sessionId, session] of this.sessions) {
      const sent = this.sendToClient(session.ws, {
        type: 'ping',
        timestamp
      });
      
      if (sent) {
        sentCount++;
      } else {
        // Schedule cleanup for disconnected session
        setTimeout(() => this.removeClient(session.ws), 100);
      }
    }
    
    log(`[MCP Session] Pinged ${sentCount}/${this.sessions.size} sessions`);
    return sentCount;
  }

  /**
   * Get status information about the MCP session service
   * @returns {Object} Status information
   */
  getStatus() {
    const sessions = this.getActiveSessions();
    const pendingRequests = Array.from(this.requestQueue.entries()).map(([requestId, request]) => ({
      requestId,
      sessionId: request.sessionId,
      pendingFor: Date.now() - request.startTime,
      codeSnippet: request.code
    }));

    return {
      clientCount: this.clients.size,
      sessionCount: this.sessions.size,
      pendingRequestCount: this.requestQueue.size,
      sessions,
      pendingRequests
    };
  }

  /**
   * Clean up all sessions and connections
   */
  cleanup() {
    // Clear all pending requests
    for (const [requestId, request] of this.requestQueue) {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      request.reject(new Error('Service shutting down'));
    }
    this.requestQueue.clear();

    // Close all client connections
    for (const client of this.clients) {
      try {
        client.close();
      } catch (error) {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
    this.sessions.clear();

    log('[MCP Session] Service cleaned up');
  }
}

// Generate UUID helper if not available in utils
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default McpSessionService;