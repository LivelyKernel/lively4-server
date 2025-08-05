import fs from 'fs';
import Path from 'path';
import { log } from '../utils.js';

/**
 * File watching service that monitors file system changes and notifies clients via WebSocket
 */
class FileWatchService {
  constructor(lively4Directory = null) {
    this.watchers = new Map(); // path -> fs.FSWatcher
    this.clients = new Set(); // WebSocket connections
    this.watchedPaths = new Set(); // tracked directories/files
    this.lively4Directory = lively4Directory; // Base directory for relative paths
    this.fileExistenceCache = new Map(); // Track file existence for CREATE/DELETE detection
  }

  /**
   * Add a WebSocket client to receive file change notifications
   * @param {WebSocket} ws - WebSocket connection
   */
  addClient(ws) {
    this.clients.add(ws);
    log(`[FileWatch] Client connected. Total clients: ${this.clients.size}`);

    ws.on('close', () => {
      this.clients.delete(ws);
      log(`[FileWatch] Client disconnected. Total clients: ${this.clients.size}`);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        log(`[FileWatch] Invalid message from client: ${error.message}`);
      }
    });
  }

  /**
   * Handle messages from WebSocket clients
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message object
   */
  handleClientMessage(ws, message) {
    switch (message.type) {
      case 'watch':
        this.watchPath(message.path);
        ws.send(JSON.stringify({ type: 'ack', path: message.path }));
        break;
      case 'unwatch':
        this.unwatchPath(message.path);
        ws.send(JSON.stringify({ type: 'ack', path: message.path }));
        break;
      default:
        log(`[FileWatch] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Start watching a file or directory
   * @param {string} filePath - Path to watch
   */
  watchPath(filePath) {
    if (this.watchers.has(filePath)) {
      return; // Already watching
    }

    try {
      const watcher = fs.watch(filePath, { recursive: true }, (eventType, filename) => {
        this.handleFileChange(eventType, filePath, filename);
      });

      this.watchers.set(filePath, watcher);
      this.watchedPaths.add(filePath);
      log(`[FileWatch] Started watching: ${filePath}`);
    } catch (error) {
      log(`[FileWatch] Error watching ${filePath}: ${error.message}`);
    }
  }

  /**
   * Stop watching a file or directory
   * @param {string} filePath - Path to stop watching
   */
  unwatchPath(filePath) {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(filePath);
      this.watchedPaths.delete(filePath);
      log(`[FileWatch] Stopped watching: ${filePath}`);
    }
  }

  /**
   * Determine the specific file operation type (CREATE, DELETE, CHANGE, MOVE)
   * @param {string} eventType - The raw fs.watch event type
   * @param {string} fullPath - The full path to the file
   * @param {boolean} exists - Whether the file currently exists
   * @return {string} The specific operation type
   */
  determineOperationType(eventType, fullPath, exists) {
    const wasTracked = this.fileExistenceCache.has(fullPath);
    const previouslyExisted = this.fileExistenceCache.get(fullPath);

    if (eventType === 'rename') {
      if (!wasTracked && exists) {
        // New file appeared
        this.fileExistenceCache.set(fullPath, true);
        return 'CREATE';
      } else if (wasTracked && previouslyExisted && !exists) {
        // File disappeared
        this.fileExistenceCache.set(fullPath, false);
        return 'DELETE';
      } else if (wasTracked && !previouslyExisted && exists) {
        // File reappeared (could be MOVE destination)
        this.fileExistenceCache.set(fullPath, true);
        return 'CREATE'; // We can't easily detect MOVE without tracking source
      }
    } else if (eventType === 'change') {
      if (exists) {
        // File was modified
        this.fileExistenceCache.set(fullPath, true);
        return 'CHANGE';
      }
    }

    // Update cache for future comparisons
    this.fileExistenceCache.set(fullPath, exists);
    
    // Fallback to generic eventType
    return eventType.toUpperCase();
  }

  /**
   * Convert absolute path to relative path from Lively4 directory
   * @param {string} absolutePath - The absolute file path
   * @return {string} Relative path from Lively4 directory
   */
  makeRelativePath(absolutePath) {
    if (!this.lively4Directory) {
      return absolutePath;
    }
    
    // Normalize paths to handle different separators
    const normalizedBase = Path.resolve(this.lively4Directory);
    const normalizedPath = Path.resolve(absolutePath);
    
    // Check if path is within the Lively4 directory
    if (normalizedPath.startsWith(normalizedBase)) {
      const relativePath = Path.relative(normalizedBase, normalizedPath);
      return relativePath || '.'; // Return '.' for the root directory itself
    }
    
    // If not within Lively4 directory, return the absolute path
    return absolutePath;
  }

  /**
   * Check if a file should be ignored from file watching
   * @param {string} filename - The relative filename that changed
   * @param {string} fullPath - The full path to the file
   * @return {boolean} True if the file should be ignored
   */
  shouldIgnoreFile(filename, fullPath) {
    const basename = Path.basename(filename);

    // Server log files (check both basename and full path)
    if (basename === 'server.log' ||
      basename === 'server.log.last' ||
      fullPath.endsWith('/server.log') ||
      fullPath.endsWith('/server.log.last')) {
      return true;
    }

    // Lively4 server directory itself - ignore changes to server files
    if (fullPath.includes('/lively4-server/') && (
      basename.endsWith('.log') ||
      filename.includes('node_modules') ||
      filename.includes('tmp/') ||
      basename.endsWith('.pid')
    )) {
      return true;
    }

    // Temporary files and common editor files
    if (basename.startsWith('.') && (
      basename.endsWith('.tmp') ||
      basename.endsWith('.swp') ||
      basename.endsWith('.swo') ||
      basename.includes('~')
    )) {
      return true;
    }

    // Git repository files
    if (fullPath.includes('/.git/') || basename === '.git') {
      return true;
    }
    
    // Node.js and build artifacts
    if (basename === 'node_modules' ||
      basename === 'package-lock.json' ||
      basename.startsWith('npm-debug') ||
      basename.endsWith('.pid')) {
      return true;
    }

    // OS-specific files
    if (basename === '.DS_Store' ||
      basename === 'Thumbs.db' ||
      basename === 'desktop.ini') {
      return true;
    }

    return false;
  }

  /**
   * Handle file system change events
   * @param {string} eventType - Type of change (rename, change)
   * @param {string} watchedPath - The path being watched
   * @param {string} filename - The filename that changed
   */
  handleFileChange(eventType, watchedPath, filename) {
    if (!filename) return; // Skip events without filename

    const fullPath = Path.join(watchedPath, filename);

    // Filter out server-related files to prevent infinite loops
    if (this.shouldIgnoreFile(filename, fullPath)) {
      return;
    }

    // Get file stats to determine if it's a file or directory
    let isDirectory = false;
    let exists = true;
    try {
      const stats = fs.statSync(fullPath);
      isDirectory = stats.isDirectory();
    } catch (error) {
      // File might have been deleted
      exists = false;
    }

    // Determine the specific operation type
    const operationType = this.determineOperationType(eventType, fullPath, exists);

    // Convert paths to be relative to Lively4 directory
    const livelyRelativePath = this.makeRelativePath(fullPath);
    const watchedRelativePath = this.makeRelativePath(watchedPath);

    const changeEvent = {
      type: 'file-change',
      eventType: operationType,
      rawEventType: eventType, // Keep the original for debugging
      path: livelyRelativePath,
      relativePath: filename,
      watchedPath: watchedRelativePath,
      isDirectory,
      exists,
      timestamp: Date.now()
    };

    log(`[FileWatch] File ${operationType}: ${livelyRelativePath}`);

    // Broadcast to all connected clients
    this.broadcastToClients(changeEvent);
  }

  /**
   * Broadcast a message to all connected WebSocket clients
   * @param {Object} message - Message to broadcast
   */
  broadcastToClients(message) {
    const messageStr = JSON.stringify(message);
    const clientsToRemove = [];

    for (const client of this.clients) {
      try {
        if (client.readyState === client.OPEN) {
          client.send(messageStr);
        } else {
          clientsToRemove.push(client);
        }
      } catch (error) {
        log(`[FileWatch] Error sending to client: ${error.message}`);
        clientsToRemove.push(client);
      }
    }

    // Clean up disconnected clients
    for (const client of clientsToRemove) {
      this.clients.delete(client);
    }
  }

  /**
   * Get status information about the file watching service
   * @return {Object} Status information
   */
  getStatus() {
    return {
      clientCount: this.clients.size,
      watchedPaths: Array.from(this.watchedPaths),
      watcherCount: this.watchers.size
    };
  }

  /**
   * Clean up all watchers and connections
   */
  cleanup() {
    // Close all watchers
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      log(`[FileWatch] Closed watcher for: ${path}`);
    }
    this.watchers.clear();
    this.watchedPaths.clear();
    this.fileExistenceCache.clear();

    // Close all client connections
    for (const client of this.clients) {
      try {
        client.close();
      } catch (error) {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
  }
}

export default FileWatchService;