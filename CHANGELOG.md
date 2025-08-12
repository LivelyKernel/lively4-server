# Changelog

All notable changes to this project will be documented in this file.

---

## [2025-08-11] - Documentation Updates

### Changed — Docs

- Updated project documentation and guides

---

## [2025-08-08] - Terminal Service with WebSocket Support

### Added — Terminal

- New Terminal service providing PTY-backed terminal sessions
- HTTP endpoint to create terminals: `/_terminal/create`
- HTTP endpoint to set terminal size: `/_terminal/size/:pid`
- WebSocket endpoint to attach to a terminal: `/_terminal/ws/:pid`
- Basic session management and authentication checks for terminal connections
- Initial test coverage for terminal service

---

## [2025-08-07] - File Watcher Auto-Recovery

### Fixed

- **Critical**: File watcher no longer stops working after Claude Code edits files
- Added automatic detection and recovery from atomic file operations (temp file + rename pattern)

### Added

- New diagnostic endpoint: `/_filewatch/validate` for watcher health checks
- Enhanced logging for file watcher events and successful client notifications
- Comprehensive test coverage for atomic file operations

---

## [2025-08-06] - File Watcher Improvements & Event Deduplication

### Added

- Comprehensive dotfile filtering in file watcher service
- Event deduplication system to prevent duplicate file change notifications
- Enhanced test coverage for file watching functionality

### Fixed

- File deletion events now correctly show as "DELETE" instead of "RENAME"
- Duplicate change notifications eliminated within 50ms time window
- Improved event type detection logic for filesystem operations

### Changed

- File watcher now ignores all files starting with "." (dotfiles)
- Simplified operation type determination algorithm
- Enhanced file existence cache management

---

## [2025-08-05] - Initial File Watching Service

### Added — File Watch

- Implemented file watching service and initial tests
- Introduced WebSocket-based file watch endpoint
- Added on-demand path watching and a system limits endpoint
- Enhanced `bin/watch.sh` to monitor all JavaScript files
- Added contributor documentation and README updates

---

## Previous Changes

*This changelog was created on 2025-08-06. Previous changes were not documented.*
