import fs from 'fs';
import Path from 'path';
import { log } from '../utils.js';

/**
 * File watching service that monitors file system changes and notifies clients via WebSocket
 */
class FileWatchService {
  constructor(lively4Directory = null) {
    this.watchers = new Map(); // path -> { watcher: fs.FSWatcher, clients: Set, recursive: boolean }
    this.clients = new Set(); // WebSocket connections
    this.clientInterests = new Map(); // client -> Set of paths they're interested in
    this.lively4Directory = lively4Directory; // Base directory for relative paths
    this.fileExistenceCache = new Map(); // Track file existence for CREATE/DELETE detection
    this.recentNotifications = new Map(); // path -> { eventType, timestamp } for deduplication
    this.deduplicationWindow = 50; // milliseconds - ignore duplicate events within this window
  }

  /**
   * Add a WebSocket client to receive file change notifications
   * @param {WebSocket} ws - WebSocket connection
   */
  addClient(ws) {
    this.clients.add(ws);
    this.clientInterests.set(ws, new Set());
    log(`[FileWatch] Client connected. Total clients: ${this.clients.size}`);

    ws.on('close', () => {
      this.removeClient(ws);
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
   * Remove a client and clean up their interests
   * @param {WebSocket} ws - WebSocket connection to remove
   */
  removeClient(ws) {
    // Get all paths this client was interested in
    const clientPaths = this.clientInterests.get(ws) || new Set();

    // Remove client from all watchers and potentially stop watchers
    for (const path of clientPaths) {
      this.removeClientInterest(ws, path);
    }

    // Clean up client tracking
    this.clients.delete(ws);
    this.clientInterests.delete(ws);

    log(`[FileWatch] Client disconnected. Total clients: ${this.clients.size}`);
  }

  /**
   * Handle messages from WebSocket clients
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message object
   */
  handleClientMessage(ws, message) {
    switch (message.type) {
      case 'watch':
        this.addClientInterest(ws, message.path);
        ws.send(JSON.stringify({ type: 'ack', path: message.path, watching: true }));
        break;
      case 'unwatch':
        this.removeClientInterest(ws, message.path);
        ws.send(JSON.stringify({ type: 'ack', path: message.path, watching: false }));
        break;
      default:
        log(`[FileWatch] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Add a client's interest in a path and start watching if needed
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} path - Path to watch
   */
  addClientInterest(ws, path) {
    // Convert to absolute path if relative
    const absolutePath = Path.isAbsolute(path) ? path : Path.resolve(this.lively4Directory || '.', path);

    // Add to client's interests
    const clientPaths = this.clientInterests.get(ws);
    if (clientPaths) {
      clientPaths.add(absolutePath);
    }

    // Check if we already have a watcher for this path
    if (this.watchers.has(absolutePath)) {
      // Add client to existing watcher
      const watcherInfo = this.watchers.get(absolutePath);
      watcherInfo.clients.add(ws);
      log(`[FileWatch] Added client interest to existing watcher: ${absolutePath} (${watcherInfo.clients.size} clients)`);
    } else {
      // Create new watcher
      this.startWatchingPath(absolutePath, ws);
    }
  }

  /**
   * Remove a client's interest in a path and stop watching if no one else is interested
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} path - Path to unwatch
   */
  removeClientInterest(ws, path) {
    // Convert to absolute path if relative
    const absolutePath = Path.isAbsolute(path) ? path : Path.resolve(this.lively4Directory || '.', path);

    // Remove from client's interests
    const clientPaths = this.clientInterests.get(ws);
    if (clientPaths) {
      clientPaths.delete(absolutePath);
    }

    const watcherInfo = this.watchers.get(absolutePath);
    if (watcherInfo) {
      // Remove client from watcher
      watcherInfo.clients.delete(ws);

      if (watcherInfo.clients.size === 0) {
        // No more clients interested, stop watching
        this.stopWatchingPath(absolutePath);
        log(`[FileWatch] Stopped watching (no clients): ${absolutePath}`);
      } else {
        log(`[FileWatch] Removed client interest: ${absolutePath} (${watcherInfo.clients.size} clients remaining)`);
      }
    }
  }

  /**
   * Start watching a file or directory (internal method)
   * @param {string} filePath - Path to watch
   * @param {WebSocket} initialClient - The client that requested this watch
   */
  startWatchingPath(filePath, initialClient) {
    try {
      // Determine if we should watch recursively based on path type
      const recursive = this.shouldWatchRecursively(filePath);

      const watcher = fs.watch(filePath, { recursive }, (eventType, filename) => {
        this.handleFileChange(eventType, filePath, filename);
      });

      // Handle watcher errors (like ENOSPC - too many watchers)
      watcher.on('error', (error) => {
        log(`[FileWatch] Watcher error for ${filePath}: ${error.message}`);

        if (error.code === 'ENOSPC') {
          log(`[FileWatch] System limit for file watchers reached. Consider increasing fs.inotify.max_user_watches`);
          log(`[FileWatch] Run: echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p`);
        }

        // Clean up the failed watcher and notify clients
        this.stopWatchingPath(filePath);
      });

      // Store watcher info with client set
      const watcherInfo = {
        watcher,
        clients: new Set([initialClient]),
        recursive
      };

      this.watchers.set(filePath, watcherInfo);
      log(`[FileWatch] Started watching ${recursive ? 'recursively' : 'non-recursively'}: ${filePath}`);
    } catch (error) {
      log(`[FileWatch] Error watching ${filePath}: ${error.message}`);

      if (error.code === 'ENOSPC') {
        log(`[FileWatch] System limit for file watchers reached. Consider increasing fs.inotify.max_user_watches`);
      }
    }
  }

  /**
   * Stop watching a file or directory (internal method)
   * @param {string} filePath - Path to stop watching
   */
  stopWatchingPath(filePath) {
    const watcherInfo = this.watchers.get(filePath);
    if (watcherInfo) {
      try {
        watcherInfo.watcher.close();
      } catch (error) {
        // Ignore close errors
      }
      this.watchers.delete(filePath);
      log(`[FileWatch] Stopped watching: ${filePath}`);
    }
  }

  /**
   * Determine if a path should be watched recursively
   * @param {string} filePath - Path to evaluate
   * @return {boolean} Whether to watch recursively
   */
  shouldWatchRecursively(filePath) {
    // If it's the root Lively4 directory itself, don't watch recursively to avoid large subdirs
    if (filePath === this.lively4Directory) {
      return false;
    }

    // For subdirectories, watch recursively by default
    return true;
  }

  /**
   * Determine the specific file operation type (CREATE, DELETE, CHANGE, MOVE)
   * @param {string} eventType - The raw fs.watch event type
   * @param {string} fullPath - The full path to the file
   * @param {boolean} exists - Whether the file currently exists
   * @return {string} The specific operation type
   */
  determineOperationType(eventType, fullPath, exists) {
    if (eventType === 'rename') {
      if (exists) {
        // File exists after rename event - this is a CREATE
        this.fileExistenceCache.set(fullPath, true);
        return 'CREATE';
      } else {
        // File doesn't exist after rename event - this is a DELETE
        this.fileExistenceCache.set(fullPath, false);
        return 'DELETE';
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

    // Ignore all files starting with "." (dotfiles)
    if (basename.startsWith('.')) {
      return true;
    }

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

    // Essential directories that should always be ignored
    const essentialIgnorePatterns = [
      'node_modules',
      '.cache',
      '.tmp'
    ];

    if (essentialIgnorePatterns.some(pattern =>
      filename.includes(`/${pattern}/`) ||
      filename.includes(`\\${pattern}\\`) ||
      basename === pattern
    )) {
      return true;
    }

    // Git repository files (including files inside .git directories)
    if (fullPath.includes('/.git/')) {
      return true;
    }

    // Ignore options directory and its contents
    if (fullPath.includes('/.options/')) {
      return true;
    }

    // Temporary files and common editor files (non-dotfiles)
    if (basename.includes('~') || 
        basename.endsWith('.tmp') || 
        basename.includes('.tmp.')) {
      return true;
    }

    // Node.js and build artifacts
    if (basename === 'node_modules' ||
      basename === 'package-lock.json' ||
      basename.startsWith('npm-debug') ||
      basename.endsWith('.pid')) {
      return true;
    }

    // OS-specific files (non-dotfiles)
    if (basename === 'Thumbs.db' ||
      basename === 'desktop.ini') {
      return true;
    }

    return false;
  }

  /**
   * Check if a notification is a duplicate within the deduplication window
   * @param {string} fullPath - The full path to the file
   * @param {string} operationType - The operation type (CREATE, CHANGE, DELETE)
   * @param {number} timestamp - Current timestamp
   * @return {boolean} True if this is a duplicate notification
   */
  isDuplicateNotification(fullPath, operationType, timestamp) {
    const key = `${fullPath}:${operationType}`;
    const recent = this.recentNotifications.get(key);
    
    if (recent && (timestamp - recent.timestamp) < this.deduplicationWindow) {
      return true; // This is a duplicate
    }
    
    // Update the recent notification
    this.recentNotifications.set(key, { timestamp });
    
    // Clean up old entries to prevent memory leak
    if (this.recentNotifications.size > 1000) {
      const cutoff = timestamp - this.deduplicationWindow * 10;
      for (const [k, v] of this.recentNotifications.entries()) {
        if (v.timestamp < cutoff) {
          this.recentNotifications.delete(k);
        }
      }
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
    const timestamp = Date.now();

    // Check for duplicate notifications
    if (this.isDuplicateNotification(fullPath, operationType, timestamp)) {
      log(`[FileWatch] Skipping duplicate ${operationType} event for: ${fullPath}`);
      return;
    }

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
      timestamp
    };

    log(`[FileWatch] File ${operationType}: ${livelyRelativePath}`);

    // Broadcast to interested clients
    this.broadcastToClients(changeEvent, watchedPath);
  }

  /**
   * Broadcast a message to interested WebSocket clients
   * @param {Object} message - Message to broadcast
   * @param {string} watchedPath - The path that triggered the change
   */
  broadcastToClients(message, watchedPath) {
    const messageStr = JSON.stringify(message);
    const clientsToRemove = [];
    const watcherInfo = this.watchers.get(watchedPath);

    if (!watcherInfo) {
      return; // No watcher info, no clients to notify
    }

    // Only send to clients interested in this path
    for (const client of watcherInfo.clients) {
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
      this.removeClient(client);
    }
  }

  /**
   * Check system file watcher limits
   * @return {Object} System limit information
   */
  async getSystemLimits() {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      try {
        const { stdout: maxWatches } = await execAsync('cat /proc/sys/fs/inotify/max_user_watches');
        const { stdout: maxInstances } = await execAsync('cat /proc/sys/fs/inotify/max_user_instances');

        return {
          maxUserWatches: parseInt(maxWatches.trim()),
          maxUserInstances: parseInt(maxInstances.trim()),
          currentWatchers: this.watchers.size
        };
      } catch (error) {
        return {
          error: 'Could not read system limits',
          currentWatchers: this.watchers.size
        };
      }
    } catch (error) {
      return {
        error: 'System limit check not available',
        currentWatchers: this.watchers.size
      };
    }
  }

  /**
   * Get status information about the file watching service
   * @return {Object} Status information
   */
  getStatus() {
    const watchedPaths = Array.from(this.watchers.keys());
    const pathDetails = {};

    for (const [path, watcherInfo] of this.watchers) {
      pathDetails[path] = {
        clientCount: watcherInfo.clients.size,
        recursive: watcherInfo.recursive
      };
    }

    return {
      clientCount: this.clients.size,
      watchedPaths,
      watcherCount: this.watchers.size,
      pathDetails
    };
  }

  /**
   * Clean up all watchers and connections
   */
  cleanup() {
    // Close all watchers
    for (const [path, watcherInfo] of this.watchers) {
      try {
        watcherInfo.watcher.close();
      } catch (error) {
        // Ignore close errors
      }
      log(`[FileWatch] Closed watcher for: ${path}`);
    }
    this.watchers.clear();
    this.fileExistenceCache.clear();
    this.recentNotifications.clear();

    // Close all client connections
    for (const client of this.clients) {
      try {
        client.close();
      } catch (error) {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
    this.clientInterests.clear();
  }
}

export default FileWatchService;