import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FileWatchService from '../../src/services/filewatch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('FileWatchService', function() {
  let fileWatchService;
  let tempDir;
  let testFiles = [];

  beforeEach(function() {
    // Create a temporary directory for testing
    tempDir = path.join(__dirname, '..', 'tmp', 'filewatch-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Initialize the file watch service with temp directory as lively4 root
    fileWatchService = new FileWatchService(tempDir);
    testFiles = [];
  });

  afterEach(function() {
    // Cleanup
    if (fileWatchService) {
      fileWatchService.cleanup();
    }
    
    // Remove test files and directory
    testFiles.forEach(filePath => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    });
    
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Constructor and Initialization', function() {
    it('should initialize with correct properties', function() {
      expect(fileWatchService.watchers).to.be.instanceOf(Map);
      expect(fileWatchService.clients).to.be.instanceOf(Set);
      expect(fileWatchService.watchedPaths).to.be.instanceOf(Set);
      expect(fileWatchService.fileExistenceCache).to.be.instanceOf(Map);
      expect(fileWatchService.lively4Directory).to.equal(tempDir);
    });
  });

  describe('Path Handling', function() {
    it('should convert absolute paths to relative paths', function() {
      const testFile = path.join(tempDir, 'test.js');
      const relativePath = fileWatchService.makeRelativePath(testFile);
      expect(relativePath).to.equal('test.js');
    });

    it('should handle nested directory paths', function() {
      const testFile = path.join(tempDir, 'src', 'components', 'test.js');
      const relativePath = fileWatchService.makeRelativePath(testFile);
      expect(relativePath).to.equal(path.join('src', 'components', 'test.js'));
    });

    it('should return absolute path for files outside lively4 directory', function() {
      const outsideFile = '/tmp/outside.js';
      const result = fileWatchService.makeRelativePath(outsideFile);
      expect(result).to.equal(outsideFile);
    });
  });

  describe('File Filtering', function() {
    it('should ignore server log files', function() {
      expect(fileWatchService.shouldIgnoreFile('server.log', '/path/server.log')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('server.log.last', '/path/server.log.last')).to.be.true;
    });

    it('should ignore git files', function() {
      expect(fileWatchService.shouldIgnoreFile('.git', '/path/.git')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('config', '/path/.git/config')).to.be.true;
    });

    it('should ignore temporary files', function() {
      expect(fileWatchService.shouldIgnoreFile('.tmp', '/path/.tmp')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('.swp', '/path/.swp')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('.test~', '/path/.test~')).to.be.true;
    });

    it('should ignore node_modules', function() {
      expect(fileWatchService.shouldIgnoreFile('node_modules', '/path/node_modules')).to.be.true;
    });

    it('should ignore OS-specific files', function() {
      expect(fileWatchService.shouldIgnoreFile('.DS_Store', '/path/.DS_Store')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('Thumbs.db', '/path/Thumbs.db')).to.be.true;
    });

    it('should not ignore regular files', function() {
      expect(fileWatchService.shouldIgnoreFile('test.js', '/path/test.js')).to.be.false;
      expect(fileWatchService.shouldIgnoreFile('README.md', '/path/README.md')).to.be.false;
    });
  });

  describe('Operation Type Detection', function() {
    it('should detect CREATE operation for new files', function() {
      const testPath = path.join(tempDir, 'new-file.js');
      const operation = fileWatchService.determineOperationType('rename', testPath, true);
      expect(operation).to.equal('CREATE');
    });

    it('should detect DELETE operation for removed files', function() {
      const testPath = path.join(tempDir, 'deleted-file.js');
      
      // Simulate file existed before
      fileWatchService.fileExistenceCache.set(testPath, true);
      
      const operation = fileWatchService.determineOperationType('rename', testPath, false);
      expect(operation).to.equal('DELETE');
    });

    it('should detect CHANGE operation for modified files', function() {
      const testPath = path.join(tempDir, 'changed-file.js');
      const operation = fileWatchService.determineOperationType('change', testPath, true);
      expect(operation).to.equal('CHANGE');
    });

    it('should update file existence cache', function() {
      const testPath = path.join(tempDir, 'cache-test.js');
      
      fileWatchService.determineOperationType('rename', testPath, true);
      expect(fileWatchService.fileExistenceCache.get(testPath)).to.be.true;
      
      fileWatchService.determineOperationType('rename', testPath, false);
      expect(fileWatchService.fileExistenceCache.get(testPath)).to.be.false;
    });
  });

  describe('Watching Operations', function() {
    it('should start watching a directory', function() {
      fileWatchService.watchPath(tempDir);
      
      expect(fileWatchService.watchers.has(tempDir)).to.be.true;
      expect(fileWatchService.watchedPaths.has(tempDir)).to.be.true;
    });

    it('should not duplicate watchers for same path', function() {
      fileWatchService.watchPath(tempDir);
      fileWatchService.watchPath(tempDir);
      
      expect(fileWatchService.watchers.size).to.equal(1);
      expect(fileWatchService.watchedPaths.size).to.equal(1);
    });

    it('should stop watching a directory', function() {
      fileWatchService.watchPath(tempDir);
      expect(fileWatchService.watchers.has(tempDir)).to.be.true;
      
      fileWatchService.unwatchPath(tempDir);
      expect(fileWatchService.watchers.has(tempDir)).to.be.false;
      expect(fileWatchService.watchedPaths.has(tempDir)).to.be.false;
    });
  });

  describe('Client Management', function() {
    let mockWebSocket;

    beforeEach(function() {
      mockWebSocket = {
        readyState: 1, // WebSocket.OPEN
        OPEN: 1,
        send: function(data) { this.lastSent = data; },
        on: function(event, callback) { 
          this.handlers = this.handlers || {};
          this.handlers[event] = callback; 
        },
        close: function() { this.readyState = 3; }, // WebSocket.CLOSED
        lastSent: null,
        handlers: {}
      };
    });

    it('should add client to the set', function() {
      fileWatchService.addClient(mockWebSocket);
      expect(fileWatchService.clients.has(mockWebSocket)).to.be.true;
      expect(fileWatchService.clients.size).to.equal(1);
    });

    it('should handle client watch messages', function() {
      fileWatchService.addClient(mockWebSocket);
      
      const watchMessage = { type: 'watch', path: tempDir };
      fileWatchService.handleClientMessage(mockWebSocket, watchMessage);
      
      expect(fileWatchService.watchedPaths.has(tempDir)).to.be.true;
      expect(mockWebSocket.lastSent).to.include('"type":"ack"');
    });

    it('should handle client unwatch messages', function() {
      fileWatchService.watchPath(tempDir);
      fileWatchService.addClient(mockWebSocket);
      
      const unwatchMessage = { type: 'unwatch', path: tempDir };
      fileWatchService.handleClientMessage(mockWebSocket, unwatchMessage);
      
      expect(fileWatchService.watchedPaths.has(tempDir)).to.be.false;
    });

    it('should broadcast messages to all clients', function() {
      const mockClient1 = { ...mockWebSocket };
      const mockClient2 = { ...mockWebSocket };
      
      fileWatchService.addClient(mockClient1);
      fileWatchService.addClient(mockClient2);
      
      const testMessage = { type: 'test', data: 'broadcast' };
      fileWatchService.broadcastToClients(testMessage);
      
      const expectedMessage = JSON.stringify(testMessage);
      expect(mockClient1.lastSent).to.equal(expectedMessage);
      expect(mockClient2.lastSent).to.equal(expectedMessage);
    });
  });

  describe('Status Information', function() {
    it('should return correct status', function() {
      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function() {},
        on: function() {}
      };
      
      fileWatchService.addClient(mockClient);
      fileWatchService.watchPath(tempDir);
      
      const status = fileWatchService.getStatus();
      
      expect(status.clientCount).to.equal(1);
      expect(status.watchedPaths).to.include(tempDir);
      expect(status.watcherCount).to.equal(1);
    });
  });

  describe('Cleanup', function() {
    it('should clean up all resources', function() {
      const mockClient = {
        readyState: 1,
        close: function() { this.closed = true; },
        on: function() {},
        closed: false
      };
      
      fileWatchService.addClient(mockClient);
      fileWatchService.watchPath(tempDir);
      fileWatchService.fileExistenceCache.set('/test', true);
      
      fileWatchService.cleanup();
      
      expect(fileWatchService.watchers.size).to.equal(0);
      expect(fileWatchService.watchedPaths.size).to.equal(0);
      expect(fileWatchService.clients.size).to.equal(0);
      expect(fileWatchService.fileExistenceCache.size).to.equal(0);
    });
  });

  describe('Integration Tests', function() {
    it('should detect file creation in real time', function(done) {
      this.timeout(5000);
      
      let changeDetected = false;
      
      // Mock client to receive notifications
      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function(data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.eventType === 'CREATE') {
            changeDetected = true;
            expect(change.path).to.equal('test-create.js');
            expect(change.exists).to.be.true;
            done();
          }
        },
        on: function() {}
      };
      
      fileWatchService.addClient(mockClient);
      fileWatchService.watchPath(tempDir);
      
      // Create a file after a short delay
      setTimeout(() => {
        const testFile = path.join(tempDir, 'test-create.js');
        testFiles.push(testFile);
        fs.writeFileSync(testFile, 'console.log("test");');
      }, 100);
      
      // Fail the test if no change detected within timeout
      setTimeout(() => {
        if (!changeDetected) {
          done(new Error('File creation was not detected'));
        }
      }, 3000);
    });

    it('should detect file modification', function(done) {
      this.timeout(5000);
      
      const testFile = path.join(tempDir, 'test-modify.js');
      testFiles.push(testFile);
      
      // Create initial file
      fs.writeFileSync(testFile, 'initial content');
      
      let changeDetected = false;
      
      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function(data) {
          if (changeDetected) return; // Avoid multiple calls
          
          const change = JSON.parse(data);
          if (change.type === 'file-change' && 
              change.eventType === 'CHANGE' && 
              change.path === 'test-modify.js') {
            changeDetected = true;
            expect(change.exists).to.be.true;
            done();
          }
        },
        on: function() {}
      };
      
      fileWatchService.addClient(mockClient);
      fileWatchService.watchPath(tempDir);
      
      // Modify file after a short delay
      setTimeout(() => {
        fs.writeFileSync(testFile, 'modified content');
      }, 100);
      
      setTimeout(() => {
        if (!changeDetected) {
          done(new Error('File modification was not detected'));
        }
      }, 3000);
    });
  });
});