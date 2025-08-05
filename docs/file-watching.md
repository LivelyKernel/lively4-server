# File Watching Service

The Lively4 server provides real-time file change notifications via WebSocket. This enables Lively4 components to automatically reload when files are modified on disk.

## Basic Usage

```javascript
const ws = new WebSocket('ws://localhost:9006/_filewatch');

ws.onopen = () => {
  lively.success('Connected to file watcher');
  
  // Watch the lively4-core directory
  ws.send(JSON.stringify({
    type: 'watch',
    path: 'lively4-core'
  }));
};

ws.onmessage = (event) => {
  const change = JSON.parse(event.data);
  lively.success(`File ${change.eventType}: ${change.path}`);
};
```

## File Change Events

The server sends notifications for:
- **CREATE** - New files created
- **DELETE** - Files removed  
- **CHANGE** - Files modified

## Message Format

```javascript
{
  "type": "file-change",
  "eventType": "CREATE",        // CREATE, DELETE, CHANGE
  "path": "lively4-core/foo.js", // Relative to Lively4 directory
  "exists": true,
  "timestamp": 1625123456789
}
```

## Control Messages

Stop watching a path:
```javascript
ws.send(JSON.stringify({
  type: 'unwatch',
  path: 'lively4-core'
}));
```

## Status Information

Check current status:
```javascript
fetch('/_filewatch/status')
  .then(response => response.json())
  .then(status => {
    console.log(`Watching ${status.watcherCount} paths for ${status.clientCount} clients`);
  });
```

## Implementation Notes

- **On-demand watching**: Watchers only created when clients request specific paths
- **Automatic cleanup**: Watchers removed when no clients are interested  
- **Resource efficient**: Perfect for large Lively4 repositories
- **Smart filtering**: Only ignores essential files (logs, temporary files, node_modules)