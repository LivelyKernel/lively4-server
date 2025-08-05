# File Watching Service

The Lively4 server provides real-time file change notifications via WebSocket connections. This enables editors and other tools to automatically reload when files are modified on disk.

## Overview

The file watching service monitors the Lively4 repository directory for changes and broadcasts notifications to all connected WebSocket clients. This allows multiple users to see file changes in real-time and enables automatic editor reloading.

## WebSocket Endpoint

Connect to the file watching service via WebSocket:

```
ws://localhost:9006/_filewatch
```

## API Reference

### Client Messages

Send JSON messages to control file watching:

#### Watch a Path
```javascript
{
  "type": "watch",
  "path": "/path/to/directory"
}
```

#### Unwatch a Path
```javascript
{
  "type": "unwatch", 
  "path": "/path/to/directory"
}
```

### Server Messages

The server sends file change notifications as JSON:

```javascript
{
  "type": "file-change",
  "eventType": "change",           // "change" or "rename"
  "path": "/full/path/to/file.js",
  "relativePath": "file.js",
  "watchedPath": "/watched/directory",
  "isDirectory": false,
  "exists": true,
  "timestamp": 1625123456789
}
```

## REST API

### Get Status
```
GET /_filewatch/status
```

Returns current watching status:
```json
{
  "clientCount": 2,
  "watchedPaths": ["/home/user/lively4"],
  "watcherCount": 1
}
```

## Usage in Lively4

### Basic Connection

```javascript
// Connect to file watcher
const ws = new WebSocket('ws://localhost:9006/_filewatch');

ws.onopen = () => {
  console.log('Connected to file watcher');
};

ws.onmessage = (event) => {
  const change = JSON.parse(event.data);
  if (change.type === 'file-change') {
    handleFileChange(change);
  }
};

function handleFileChange(change) {
  console.log(`File ${change.eventType}: ${change.path}`);
  
  // Reload editor if current file changed
  if (change.path === currentEditingFile) {
    reloadEditor();
  }
}
```

### Watch Specific Directory

```javascript
// Watch a specific project directory
ws.send(JSON.stringify({
  type: 'watch',
  path: '/home/user/my-project'
}));
```

### Auto-reload Editor

```javascript
class Lively4Editor {
  constructor(filePath) {
    this.filePath = filePath;
    this.setupFileWatcher();
  }
  
  setupFileWatcher() {
    this.ws = new WebSocket('ws://localhost:9006/_filewatch');
    
    this.ws.onmessage = (event) => {
      const change = JSON.parse(event.data);
      
      if (change.type === 'file-change' && 
          change.path === this.filePath &&
          change.exists) {
        
        // Only reload if file was changed externally
        if (!this.isCurrentlyEditing) {
          this.reloadContent();
        }
      }
    };
  }
  
  reloadContent() {
    // Fetch updated file content and refresh editor
    fetch(this.filePath)
      .then(response => response.text())
      .then(content => {
        this.setContent(content);
        this.showNotification('File reloaded from disk');
      });
  }
}
```

## Automatic Features

- **Auto-start**: The server automatically watches the Lively4 directory on startup
- **Multi-client**: All connected clients receive the same notifications
- **Recursive**: Watches entire directory trees, including subdirectories
- **Filtered**: Ignores server logs, temporary files, and build artifacts

## Ignored Files

The service automatically filters out files that shouldn't trigger notifications:

- Server logs (`server.log`, `server.log.last`)
- Temporary files (`.tmp`, `.swp`, `~` files)
- Build artifacts (`node_modules`, `package-lock.json`)
- Version control (`.git` directory)
- OS files (`.DS_Store`, `Thumbs.db`)

## Performance Notes

- Uses native Node.js `fs.watch` for efficient file system monitoring
- Recursive watching is supported on all platforms
- WebSocket connections are automatically cleaned up on disconnect
- File changes are debounced to prevent excessive notifications

## Error Handling

The service handles common error scenarios:

- **Invalid paths**: Silently ignores watch requests for non-existent paths
- **Permission errors**: Logs errors but continues watching other paths
- **Client disconnects**: Automatically removes disconnected clients
- **File deletion**: Reports deletion events with `exists: false`

## Debugging

Enable debug logging to see file change events:

```bash
# Server logs will show:
[FileWatch] File change: change /path/to/file.js
[FileWatch] Client connected. Total clients: 1
[FileWatch] Started watching: /path/to/directory
```

## Integration Examples

### Workspace Synchronization

```javascript
// Keep multiple editor instances in sync
const workspace = {
  editors: new Map(),
  
  init() {
    this.ws = new WebSocket('ws://localhost:9006/_filewatch');
    this.ws.onmessage = (event) => {
      const change = JSON.parse(event.data);
      this.syncEditors(change);
    };
  },
  
  syncEditors(change) {
    const editor = this.editors.get(change.path);
    if (editor && !editor.hasUnsavedChanges()) {
      editor.reload();
    }
  }
};
```

### Build System Integration

```javascript
// Trigger builds on file changes
ws.onmessage = (event) => {
  const change = JSON.parse(event.data);
  
  if (change.path.endsWith('.js') || change.path.endsWith('.css')) {
    triggerBuild();
  }
};
```