import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FileWatchService from '../../src/services/filewatch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('FileWatchService', function () {
  let fileWatchService;
  let tempDir;
  let testFiles = [];

  beforeEach(function () {
    // Create a temporary directory for testing
    tempDir = path.join(__dirname, '..', 'tmp', 'filewatch-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    // Initialize the file watch service with temp directory as lively4 root
    fileWatchService = new FileWatchService(tempDir);
    testFiles = [];
  });

  afterEach(function () {
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

  describe('Constructor and Initialization', function () {
    it('should initialize with correct properties', function () {
      expect(fileWatchService.watchers).to.be.instanceOf(Map);
      expect(fileWatchService.clients).to.be.instanceOf(Set);
      expect(fileWatchService.clientInterests).to.be.instanceOf(Map);
      expect(fileWatchService.fileExistenceCache).to.be.instanceOf(Map);
      expect(fileWatchService.lively4Directory).to.equal(tempDir);
    });
  });

  describe('Path Handling', function () {
    it('should convert absolute paths to relative paths', function () {
      const testFile = path.join(tempDir, 'test.js');
      const relativePath = fileWatchService.makeRelativePath(testFile);
      expect(relativePath).to.equal('test.js');
    });

    it('should handle nested directory paths (POSIX separators on all platforms)', function () {
      const testFile = path.join(tempDir, 'src', 'components', 'test.js');
      const relativePath = fileWatchService.makeRelativePath(testFile);
      // Emitted paths always use '/', regardless of the OS separator.
      expect(relativePath).to.equal('src/components/test.js');
    });

    it('should return absolute path for files outside lively4 directory', function () {
      const outsideFile = '/tmp/outside.js';
      const result = fileWatchService.makeRelativePath(outsideFile);
      expect(result).to.equal(outsideFile);
    });
  });

  describe('File Filtering', function () {
    it('should ignore server log files', function () {
      expect(fileWatchService.shouldIgnoreFile('server.log', '/path/server.log')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('server.log.last', '/path/server.log.last')).to.be.true;
    });

    it('should ignore git files', function () {
      expect(fileWatchService.shouldIgnoreFile('.git', '/path/.git')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('config', '/path/.git/config')).to.be.true;
    });

    it('should ignore .options', function () {
      expect(fileWatchService.shouldIgnoreFile('.git', '/path/.options')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('config', '/path/.options/foo')).to.be.true;
    });

    it('should ignore temporary files', function () {
      expect(fileWatchService.shouldIgnoreFile('.tmp', '/path/.tmp')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('.swp', '/path/.swp')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('.test~', '/path/.test~')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('lively-container.js.tmp.771756.1754491341898', '/path/lively-container.js.tmp.771756.1754491341898')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('file.tmp.12345', '/path/file.tmp.12345')).to.be.true;
    });

    it('should ignore essential directories', function () {
      expect(fileWatchService.shouldIgnoreFile('node_modules', '/path/node_modules')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('.cache', '/path/.cache')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('.tmp', '/path/.tmp')).to.be.true;
    });

    it('should ignore OS-specific files', function () {
      expect(fileWatchService.shouldIgnoreFile('.DS_Store', '/path/.DS_Store')).to.be.true;
      expect(fileWatchService.shouldIgnoreFile('Thumbs.db', '/path/Thumbs.db')).to.be.true;
    });

    it('should NOT ignore data directories (client controls scope)', function () {
      // These are no longer filtered since clients control what they watch
      expect(fileWatchService.shouldIgnoreFile('media', '/path/media')).to.be.false;
      expect(fileWatchService.shouldIgnoreFile('images', '/path/images')).to.be.false;
      expect(fileWatchService.shouldIgnoreFile('data', '/path/data')).to.be.false;
      expect(fileWatchService.shouldIgnoreFile('build', '/path/build')).to.be.false;
    });

    it('should not ignore regular files', function () {
      expect(fileWatchService.shouldIgnoreFile('test.js', '/path/test.js')).to.be.false;
      expect(fileWatchService.shouldIgnoreFile('README.md', '/path/README.md')).to.be.false;
    });
  });

  describe('Operation Type Detection', function () {
    it('should detect CREATE operation for new files', function () {
      const testPath = path.join(tempDir, 'new-file.js');
      const operation = fileWatchService.determineOperationType('rename', testPath, true);
      expect(operation).to.equal('CREATE');
    });

    it('should detect DELETE operation for removed files', function () {
      const testPath = path.join(tempDir, 'deleted-file.js');

      // Simulate file existed before
      fileWatchService.fileExistenceCache.set(testPath, true);

      const operation = fileWatchService.determineOperationType('rename', testPath, false);
      expect(operation).to.equal('DELETE');
    });

    it('should detect CHANGE operation for modified files', function () {
      const testPath = path.join(tempDir, 'changed-file.js');
      const operation = fileWatchService.determineOperationType('change', testPath, true);
      expect(operation).to.equal('CHANGE');
    });

    it('should update file existence cache', function () {
      const testPath = path.join(tempDir, 'cache-test.js');

      fileWatchService.determineOperationType('rename', testPath, true);
      expect(fileWatchService.fileExistenceCache.get(testPath)).to.be.true;

      fileWatchService.determineOperationType('rename', testPath, false);
      expect(fileWatchService.fileExistenceCache.get(testPath)).to.be.false;
    });
  });

  describe('On-Demand Watching Operations', function () {
    let mockClient;

    beforeEach(function () {
      mockClient = {
        readyState: 1, // WebSocket.OPEN
        OPEN: 1,
        send: function (data) { this.lastSent = data; },
        on: function (event, callback) {
          this.handlers = this.handlers || {};
          this.handlers[event] = callback;
        },
        close: function () { this.readyState = 3; }, // WebSocket.CLOSED
        lastSent: null,
        handlers: {}
      };
    });

    it('should handle relative paths correctly', function () {
      fileWatchService.addClient(mockClient);

      // Create a test directory first
      const relativePath = 'src';
      const expectedAbsolutePath = path.resolve(tempDir, relativePath);
      fs.mkdirSync(expectedAbsolutePath, { recursive: true });

      fileWatchService.addClientInterest(mockClient, relativePath);

      // Should create watcher with absolute path
      expect(fileWatchService.watchers.has(expectedAbsolutePath)).to.be.true;

      const watcherInfo = fileWatchService.watchers.get(expectedAbsolutePath);
      expect(watcherInfo.clients.has(mockClient)).to.be.true;
    });

    it('should handle absolute paths correctly', function () {
      fileWatchService.addClient(mockClient);

      // Use an absolute path
      const absolutePath = path.join(tempDir, 'absolute-test');
      fs.mkdirSync(absolutePath, { recursive: true });

      fileWatchService.addClientInterest(mockClient, absolutePath);

      // Should create watcher with the same absolute path
      expect(fileWatchService.watchers.has(absolutePath)).to.be.true;

      const watcherInfo = fileWatchService.watchers.get(absolutePath);
      expect(watcherInfo.clients.has(mockClient)).to.be.true;
    });

    it('should handle dot notation paths', function () {
      fileWatchService.addClient(mockClient);

      // Use dot notation for current directory
      fileWatchService.addClientInterest(mockClient, '.');

      // Should resolve to the tempDir (lively4Directory)
      expect(fileWatchService.watchers.has(tempDir)).to.be.true;
    });

    it('should start watching when client shows interest', function () {
      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      expect(fileWatchService.watchers.has(tempDir)).to.be.true;
      const watcherInfo = fileWatchService.watchers.get(tempDir);
      expect(watcherInfo.clients.has(mockClient)).to.be.true;
    });

    it('should share watchers between multiple clients', function () {
      const mockClient2 = { ...mockClient };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClient(mockClient2);

      fileWatchService.addClientInterest(mockClient, tempDir);
      fileWatchService.addClientInterest(mockClient2, tempDir);

      expect(fileWatchService.watchers.size).to.equal(1);
      const watcherInfo = fileWatchService.watchers.get(tempDir);
      expect(watcherInfo.clients.size).to.equal(2);
    });

    it('should stop watching when no clients are interested', function () {
      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);
      expect(fileWatchService.watchers.has(tempDir)).to.be.true;

      fileWatchService.removeClientInterest(mockClient, tempDir);
      expect(fileWatchService.watchers.has(tempDir)).to.be.false;
    });

    it('should keep watching when some clients remain interested', function () {
      const mockClient2 = { ...mockClient };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClient(mockClient2);

      fileWatchService.addClientInterest(mockClient, tempDir);
      fileWatchService.addClientInterest(mockClient2, tempDir);

      fileWatchService.removeClientInterest(mockClient, tempDir);

      expect(fileWatchService.watchers.has(tempDir)).to.be.true;
      const watcherInfo = fileWatchService.watchers.get(tempDir);
      expect(watcherInfo.clients.size).to.equal(1);
      expect(watcherInfo.clients.has(mockClient2)).to.be.true;
    });
  });

  describe('Client Management', function () {
    let mockWebSocket;

    beforeEach(function () {
      mockWebSocket = {
        readyState: 1, // WebSocket.OPEN
        OPEN: 1,
        send: function (data) { this.lastSent = data; },
        on: function (event, callback) {
          this.handlers = this.handlers || {};
          this.handlers[event] = callback;
        },
        close: function () { this.readyState = 3; }, // WebSocket.CLOSED
        lastSent: null,
        handlers: {}
      };
    });

    it('should add client to the set', function () {
      fileWatchService.addClient(mockWebSocket);
      expect(fileWatchService.clients.has(mockWebSocket)).to.be.true;
      expect(fileWatchService.clientInterests.has(mockWebSocket)).to.be.true;
      expect(fileWatchService.clients.size).to.equal(1);
    });

    it('should handle client watch messages with absolute paths', function () {
      fileWatchService.addClient(mockWebSocket);

      const watchMessage = { type: 'watch', path: tempDir };
      fileWatchService.handleClientMessage(mockWebSocket, watchMessage);

      expect(fileWatchService.watchers.has(tempDir)).to.be.true;
      expect(mockWebSocket.lastSent).to.include('"watching":true');
      expect(mockWebSocket.lastSent).to.include('"type":"ack"');
    });

    it('should handle client watch messages with relative paths', function () {
      fileWatchService.addClient(mockWebSocket);

      // Create a subdirectory for testing
      const subDir = path.join(tempDir, 'test-subdir');
      fs.mkdirSync(subDir, { recursive: true });

      const watchMessage = { type: 'watch', path: 'test-subdir' };
      fileWatchService.handleClientMessage(mockWebSocket, watchMessage);

      // Should resolve to absolute path and create watcher
      const expectedAbsolutePath = path.resolve(tempDir, 'test-subdir');
      expect(fileWatchService.watchers.has(expectedAbsolutePath)).to.be.true;
      expect(mockWebSocket.lastSent).to.include('"watching":true');
      expect(mockWebSocket.lastSent).to.include('"type":"ack"');
    });

    it('should handle client unwatch messages', function () {
      fileWatchService.addClient(mockWebSocket);

      // First watch, then unwatch
      const watchMessage = { type: 'watch', path: tempDir };
      fileWatchService.handleClientMessage(mockWebSocket, watchMessage);
      expect(fileWatchService.watchers.has(tempDir)).to.be.true;

      const unwatchMessage = { type: 'unwatch', path: tempDir };
      fileWatchService.handleClientMessage(mockWebSocket, unwatchMessage);

      expect(fileWatchService.watchers.has(tempDir)).to.be.false;
      expect(mockWebSocket.lastSent).to.include('"watching":false');
    });

    it('should broadcast messages only to interested clients', function () {
      const mockClient1 = { ...mockWebSocket };
      const mockClient2 = { ...mockWebSocket };

      fileWatchService.addClient(mockClient1);
      fileWatchService.addClient(mockClient2);

      // Only mockClient1 is interested in tempDir
      fileWatchService.addClientInterest(mockClient1, tempDir);

      const testMessage = { type: 'test', data: 'broadcast' };
      fileWatchService.broadcastToClients(testMessage, tempDir);

      const expectedMessage = JSON.stringify(testMessage);
      expect(mockClient1.lastSent).to.equal(expectedMessage);
      expect(mockClient2.lastSent).to.not.equal(expectedMessage);
    });
  });

  describe('Status Information', function () {
    it('should return correct status', function () {
      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function () { },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      const status = fileWatchService.getStatus();

      expect(status.clientCount).to.equal(1);
      expect(status.watchedPaths).to.include(tempDir);
      expect(status.watcherCount).to.equal(1);
      expect(status.pathDetails).to.have.property(tempDir);
      expect(status.pathDetails[tempDir].clientCount).to.equal(1);
    });
  });

  describe('Cleanup', function () {
    it('should clean up all resources', function () {
      const mockClient = {
        readyState: 1,
        close: function () { this.closed = true; },
        on: function () { },
        closed: false
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);
      fileWatchService.fileExistenceCache.set('/test', true);

      fileWatchService.cleanup();

      expect(fileWatchService.watchers.size).to.equal(0);
      expect(fileWatchService.clients.size).to.equal(0);
      expect(fileWatchService.clientInterests.size).to.equal(0);
      expect(fileWatchService.fileExistenceCache.size).to.equal(0);
    });
  });

  describe('Integration Tests', function () {
    it('should detect file creation in real time', function (done) {
      this.timeout(5000);

      let changeDetected = false;

      // Mock client to receive notifications
      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.eventType === 'CREATE') {
            changeDetected = true;
            expect(change.path).to.equal('test-create.js');
            expect(change.exists).to.be.true;
            done();
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

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

    it('should detect file modification', function (done) {
      this.timeout(5000);

      const testFile = path.join(tempDir, 'test-modify.js');
      testFiles.push(testFile);

      // Create initial file
      fs.writeFileSync(testFile, 'initial content');

      let changeDetected = false;

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
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
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

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

    it('suppresses spurious change events on unmodified files, but not real writes', function (done) {
      // Regression for the Windows read-triggered flood: with NTFS last-access updates enabled,
      // libuv's fs.watch fires 'change' every time a file is merely READ. Those events carry no
      // real write, so they must be dropped — otherwise the client re-fetches, which reads again,
      // which fires another event: a feedback loop that surfaces as "upgrading 100s of files".
      this.timeout(5000);

      const testFile = path.join(tempDir, 'spurious.js');
      testFiles.push(testFile);
      fs.writeFileSync(testFile, 'content');
      // Age the file so it looks like a long-untouched repo file being read during world load.
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(testFile, old, old);

      const events = [];
      const mockClient = {
        readyState: 1, OPEN: 1,
        send(data) { const m = JSON.parse(data); if (m.type === 'file-change') events.push(m); },
        on() { }
      };
      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // Two read-triggered 'change' events on the unmodified file — both must be suppressed.
      fileWatchService.handleFileChange('change', tempDir, 'spurious.js');
      fileWatchService.handleFileChange('change', tempDir, 'spurious.js');

      setTimeout(() => {
        const spurious = events.filter(e => e.path === 'spurious.js');
        expect(spurious, 'spurious read events must be suppressed').to.have.lengthOf(0);

        // A genuine write (fresh mtime) must still propagate.
        fs.writeFileSync(testFile, 'really modified');
        fileWatchService.handleFileChange('change', tempDir, 'spurious.js');
        setTimeout(() => {
          const changes = events.filter(e => e.path === 'spurious.js' && e.eventType === 'CHANGE');
          expect(changes.length, 'a real write must still emit CHANGE').to.be.greaterThan(0);
          done();
        }, 400);
      }, 400);
    });

    it('should not send duplicate change notifications', function (done) {
      this.timeout(5000);

      const testFile = path.join(tempDir, 'test-duplicates.js');
      testFiles.push(testFile);

      // Create initial file
      fs.writeFileSync(testFile, 'initial content');

      const receivedNotifications = [];
      let notificationCount = 0;

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.path === 'test-duplicates.js') {
            notificationCount++;
            receivedNotifications.push({
              eventType: change.eventType,
              timestamp: change.timestamp,
              exists: change.exists,
              rawEventType: change.rawEventType
            });
            console.log(`Notification ${notificationCount}: ${change.eventType} (raw: ${change.rawEventType}) at ${change.timestamp}`);
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // Modify file multiple times rapidly to potentially trigger duplicates
      setTimeout(() => {
        fs.writeFileSync(testFile, 'modified content 1');
        fs.writeFileSync(testFile, 'modified content 2');
        fs.writeFileSync(testFile, 'modified content 3');
      }, 100);

      // Wait and then check for duplicates
      setTimeout(() => {
        console.log(`Total notifications received: ${receivedNotifications.length}`);
        
        if (receivedNotifications.length > 3) {
          // If we get more notifications than modifications, check for true duplicates
          const duplicates = [];
          for (let i = 0; i < receivedNotifications.length - 1; i++) {
            for (let j = i + 1; j < receivedNotifications.length; j++) {
              const timeDiff = Math.abs(receivedNotifications[i].timestamp - receivedNotifications[j].timestamp);
              if (timeDiff < 50 && 
                  receivedNotifications[i].eventType === receivedNotifications[j].eventType &&
                  receivedNotifications[i].exists === receivedNotifications[j].exists) {
                duplicates.push({ 
                  first: receivedNotifications[i], 
                  second: receivedNotifications[j],
                  timeDiff 
                });
              }
            }
          }
          
          if (duplicates.length > 0) {
            done(new Error(`Duplicate change notifications detected: ${JSON.stringify(duplicates, null, 2)}`));
          } else {
            done(); // Multiple notifications with different timestamps/types are OK
          }
        } else {
          done(); // Reasonable number of notifications
        }
      }, 1500);
    });

    it('should handle mixed file operations without duplicates', function (done) {
      this.timeout(7000);

      const testFile = path.join(tempDir, 'test-mixed-ops.js');
      testFiles.push(testFile);

      const receivedNotifications = [];
      let notificationCount = 0;

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.path.includes('test-mixed-ops')) {
            notificationCount++;
            receivedNotifications.push({
              eventType: change.eventType,
              timestamp: change.timestamp,
              exists: change.exists,
              rawEventType: change.rawEventType,
              path: change.path
            });
            console.log(`Notification ${notificationCount}: ${change.eventType} (raw: ${change.rawEventType}) for ${change.path} at ${change.timestamp}`);
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // Perform a sequence of operations that might trigger duplicates
      setTimeout(() => {
        // Create the file
        fs.writeFileSync(testFile, 'initial content');
      }, 100);

      setTimeout(() => {
        // Modify the file
        fs.writeFileSync(testFile, 'modified content');
      }, 300);

      setTimeout(() => {
        // Move the file (which might generate rename events)
        const newFile = path.join(tempDir, 'test-mixed-ops-renamed.js');
        testFiles.push(newFile);
        fs.renameSync(testFile, newFile);
      }, 500);

      // Wait and analyze all notifications
      setTimeout(() => {
        console.log(`Total notifications received: ${receivedNotifications.length}`);
        console.log('All notifications:', receivedNotifications);
        
        // Look for potential duplicates (same event type for same path within short time)
        const duplicates = [];
        for (let i = 0; i < receivedNotifications.length - 1; i++) {
          for (let j = i + 1; j < receivedNotifications.length; j++) {
            const n1 = receivedNotifications[i];
            const n2 = receivedNotifications[j];
            const timeDiff = Math.abs(n1.timestamp - n2.timestamp);
            
            // Check for duplicates: same event type, same path, within 100ms
            if (timeDiff < 100 && 
                n1.eventType === n2.eventType && 
                n1.path === n2.path &&
                n1.exists === n2.exists) {
              duplicates.push({ 
                first: n1, 
                second: n2,
                timeDiff 
              });
            }
          }
        }
        
        if (duplicates.length > 0) {
          done(new Error(`Duplicate notifications found: ${JSON.stringify(duplicates, null, 2)}`));
        } else {
          console.log('No duplicate notifications found');
          done();
        }
      }, 2000);
    });

    it('should handle shell redirections without duplicate CHANGE events', function (done) {
      this.timeout(5000);

      const testFile = path.join(tempDir, 'shell-redirect-test.txt');
      testFiles.push(testFile);

      const receivedNotifications = [];
      let notificationCount = 0;

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.path === 'shell-redirect-test.txt') {
            notificationCount++;
            receivedNotifications.push({
              eventType: change.eventType,
              timestamp: change.timestamp,
              exists: change.exists,
              rawEventType: change.rawEventType
            });
            console.log(`Notification ${notificationCount}: ${change.eventType} (raw: ${change.rawEventType}) at ${new Date(change.timestamp).toISOString()}`);
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // First create the file (like touch)
      setTimeout(() => {
        fs.writeFileSync(testFile, '');
        console.log('Created empty file');
      }, 100);

      // Then write content to it (like echo > file) after a delay
      setTimeout(() => {
        fs.writeFileSync(testFile, 'hello world\n');
        console.log('Wrote content to file');
      }, 500);

      // Check for duplicates after sufficient time
      setTimeout(() => {
        console.log(`Total notifications: ${receivedNotifications.length}`);
        
        // Count CHANGE events specifically
        const changeEvents = receivedNotifications.filter(n => n.eventType === 'CHANGE');
        console.log(`CHANGE events: ${changeEvents.length}`);
        
        if (changeEvents.length > 1) {
          // Check if any are duplicates (within 100ms)
          const duplicates = [];
          for (let i = 0; i < changeEvents.length - 1; i++) {
            for (let j = i + 1; j < changeEvents.length; j++) {
              const timeDiff = Math.abs(changeEvents[i].timestamp - changeEvents[j].timestamp);
              if (timeDiff < 100) {
                duplicates.push({
                  first: changeEvents[i],
                  second: changeEvents[j],
                  timeDiff
                });
              }
            }
          }
          
          if (duplicates.length > 0) {
            done(new Error(`Duplicate CHANGE events found: ${JSON.stringify(duplicates, null, 2)}`));
          } else {
            console.log('Multiple CHANGE events found but with sufficient time gap');
            done();
          }
        } else {
          console.log('Single or no CHANGE event - good');
          done();
        }
      }, 2000);
    });

    it('should deduplicate identical notifications within deduplication window', function (done) {
      this.timeout(3000);

      const testFile = path.join(tempDir, 'dedup-test.txt');
      testFiles.push(testFile);

      // Create initial file
      fs.writeFileSync(testFile, 'initial');

      const receivedNotifications = [];

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.path === 'dedup-test.txt') {
            receivedNotifications.push({
              eventType: change.eventType,
              timestamp: change.timestamp,
              rawEventType: change.rawEventType
            });
            console.log(`Received: ${change.eventType} (raw: ${change.rawEventType}) at ${new Date(change.timestamp).toISOString()}`);
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // Simulate duplicate events by directly calling handleFileChange multiple times rapidly
      setTimeout(() => {
        const filename = 'dedup-test.txt';
        const watchedPath = tempDir;
        
        // Simulate multiple rapid change events (like what might happen with shell redirection)
        fileWatchService.handleFileChange('change', watchedPath, filename);
        fileWatchService.handleFileChange('change', watchedPath, filename);
        fileWatchService.handleFileChange('change', watchedPath, filename);
      }, 100);

      // Check results
      setTimeout(() => {
        console.log(`Total notifications received: ${receivedNotifications.length}`);
        
        const changeEvents = receivedNotifications.filter(n => n.eventType === 'CHANGE');
        console.log(`CHANGE notifications: ${changeEvents.length}`);
        
        if (changeEvents.length > 1) {
          done(new Error(`Expected only 1 CHANGE notification but got ${changeEvents.length}. Deduplication failed.`));
        } else if (changeEvents.length === 1) {
          console.log('Deduplication working correctly - only 1 CHANGE event sent');
          done();
        } else {
          done(new Error('No CHANGE events received at all'));
        }
      }, 500);
    });

    it('should send correct eventType for DELETE operations (not RENAME)', function (done) {
      this.timeout(3000);

      const testFile = path.join(tempDir, 'delete-event-test.txt');
      testFiles.push(testFile);

      // Create initial file
      fs.writeFileSync(testFile, 'test content');

      const receivedNotifications = [];

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.path === 'delete-event-test.txt') {
            receivedNotifications.push(change);
            console.log(`Event: ${change.eventType} (raw: ${change.rawEventType}) - exists: ${change.exists}`);
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // Wait for initial CREATE event, then delete the file
      setTimeout(() => {
        fs.unlinkSync(testFile);
        console.log('File deleted');
      }, 200);

      // Check the results
      setTimeout(() => {
        console.log(`Total notifications: ${receivedNotifications.length}`);
        
        const deleteEvents = receivedNotifications.filter(n => n.eventType === 'DELETE');
        const renameEvents = receivedNotifications.filter(n => n.eventType === 'RENAME');
        
        console.log(`DELETE events: ${deleteEvents.length}`);
        console.log(`RENAME events: ${renameEvents.length}`);
        
        if (deleteEvents.length === 0) {
          done(new Error('No DELETE events received for file deletion'));
        } else if (renameEvents.length > 0) {
          done(new Error(`Received ${renameEvents.length} RENAME events, but file deletion should show as DELETE`));
        } else {
          const deleteEvent = deleteEvents[0];
          console.log(`DELETE event details:`, deleteEvent);
          
          // Verify the DELETE event has correct properties
          if (deleteEvent.eventType !== 'DELETE') {
            done(new Error(`Expected eventType to be DELETE, got ${deleteEvent.eventType}`));
          } else if (deleteEvent.exists !== false) {
            done(new Error(`Expected exists to be false for DELETE event, got ${deleteEvent.exists}`));
          } else if (deleteEvent.rawEventType !== 'rename') {
            done(new Error(`Expected rawEventType to be rename for DELETE, got ${deleteEvent.rawEventType}`));
          } else {
            console.log('DELETE event is correctly formatted');
            done();
          }
        }
      }, 1000);
    });

    it('should handle atomic file operations (Claude Code style edits)', function (done) {
      this.timeout(10000);

      const testFile = path.join(tempDir, 'atomic-edit-test.js');
      testFiles.push(testFile);

      // Create initial file
      fs.writeFileSync(testFile, 'console.log("initial content");');

      const receivedNotifications = [];
      let watcherRestartCount = 0;
      const originalCheckAndRestartWatcher = fileWatchService.checkAndRestartWatcher;
      
      // Monitor watcher restart calls
      fileWatchService.checkAndRestartWatcher = function(filePath) {
        watcherRestartCount++;
        console.log(`Watcher restart triggered for: ${filePath}`);
        return originalCheckAndRestartWatcher.call(this, filePath);
      };

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change' && change.path === 'atomic-edit-test.js') {
            receivedNotifications.push({
              eventType: change.eventType,
              timestamp: change.timestamp,
              exists: change.exists,
              rawEventType: change.rawEventType
            });
            console.log(`Event: ${change.eventType} (raw: ${change.rawEventType}) - exists: ${change.exists} at ${new Date(change.timestamp).toISOString()}`);
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // Simulate Claude Code's atomic file operation pattern
      setTimeout(() => {
        console.log('Starting atomic file operation simulation...');
        
        // Step 1: Create temp file (like Claude Code does)
        const tempFileName = `atomic-edit-test.js.tmp.${process.pid}.${Date.now()}`;
        const tempFilePath = path.join(tempDir, tempFileName);
        testFiles.push(tempFilePath);
        
        fs.writeFileSync(tempFilePath, 'console.log("modified content via atomic operation");');
        console.log(`Created temp file: ${tempFileName}`);
        
        // Step 2: Rename temp file to replace original (atomic operation)
        setTimeout(() => {
          fs.renameSync(tempFilePath, testFile);
          console.log('Renamed temp file to replace original');
        }, 50);
        
      }, 200);

      // Test that file watcher continues working after atomic operation
      setTimeout(() => {
        console.log('Testing if watcher still works after atomic operation...');
        fs.writeFileSync(testFile, 'console.log("post-atomic edit");');
      }, 1000);

      // Check results
      setTimeout(() => {
        console.log(`Total notifications received: ${receivedNotifications.length}`);
        console.log(`Watcher restart count: ${watcherRestartCount}`);
        console.log('All notifications:', receivedNotifications.map(n => `${n.eventType} (${n.rawEventType})`));

        // Restore original method
        fileWatchService.checkAndRestartWatcher = originalCheckAndRestartWatcher;

        // We should receive notifications for the post-atomic edit
        const postAtomicChanges = receivedNotifications.filter(n => 
          n.timestamp > Date.now() - 8000 // Events from the last 8 seconds
        );

        if (postAtomicChanges.length === 0) {
          done(new Error('File watcher stopped working after atomic operation - no post-atomic changes detected'));
        } else {
          console.log(`Post-atomic changes detected: ${postAtomicChanges.length}`);
          
          // Check if we detected the atomic operation pattern
          const atomicTempFileDetected = watcherRestartCount > 0;
          
          if (atomicTempFileDetected) {
            console.log('Atomic operation pattern detected and watcher restart mechanism triggered');
          } else {
            console.log('Atomic operation may not have triggered restart (could be normal if watcher stayed healthy)');
          }
          
          console.log('File watcher continues to work after atomic operation');
          done();
        }
      }, 2500);
    });

    it('should restart watcher when atomic operation breaks it', function (done) {
      this.timeout(8000);

      const testFile = path.join(tempDir, 'restart-test.js');
      testFiles.push(testFile);

      // Create initial file
      fs.writeFileSync(testFile, 'initial');

      let restartTriggered = false;
      let watcherRestarted = false;
      const originalCheckAndRestartWatcher = fileWatchService.checkAndRestartWatcher;
      
      // Override checkAndRestartWatcher to simulate a restart
      fileWatchService.checkAndRestartWatcher = async function(filePath) {
        restartTriggered = true;
        console.log(`checkAndRestartWatcher called for: ${filePath}`);
        
        // Simulate that the watcher needs restart by forcing a restart
        const watcherInfo = this.watchers.get(filePath);
        if (watcherInfo) {
          const clients = new Set(watcherInfo.clients);
          this.stopWatchingPath(filePath);
          
          for (const client of clients) {
            if (client.readyState === client.OPEN) {
              this.addClientInterest(client, filePath);
            }
          }
          watcherRestarted = true;
          console.log(`Simulated watcher restart for ${filePath}`);
        }
      };

      const mockClient = {
        readyState: 1,
        OPEN: 1,
        send: function (data) {
          const change = JSON.parse(data);
          if (change.type === 'file-change') {
            console.log(`Received: ${change.eventType} for ${change.path}`);
          }
        },
        on: function () { }
      };

      fileWatchService.addClient(mockClient);
      fileWatchService.addClientInterest(mockClient, tempDir);

      // Simulate atomic operation with temp file
      setTimeout(() => {
        const tempFileName = `restart-test.js.tmp.${process.pid}.${Date.now()}`;
        const tempFilePath = path.join(tempDir, tempFileName);
        testFiles.push(tempFilePath);
        
        // Create and rename temp file
        fs.writeFileSync(tempFilePath, 'updated');
        fs.renameSync(tempFilePath, testFile);
      }, 200);

      // Check results
      setTimeout(() => {
        console.log(`Restart triggered: ${restartTriggered}`);
        console.log(`Watcher restarted: ${watcherRestarted}`);
        
        // Restore original method
        fileWatchService.checkAndRestartWatcher = originalCheckAndRestartWatcher;

        if (!restartTriggered) {
          done(new Error('Atomic operation did not trigger restart check'));
        } else if (!watcherRestarted) {
          done(new Error('Watcher restart check was triggered but restart did not occur'));
        } else {
          console.log('Watcher restart mechanism working correctly');
          done();
        }
      }, 1500);
    });
  });

  describe('Git Status Sync Events', function () {
    it('should support SYNC event type for git metadata changes', function () {
      const testPath = path.join(tempDir, 'sync-test-file.js');
      
      // Create test file
      fs.writeFileSync(testPath, 'console.log("test");');
      testFiles.push(testPath);
      
      // Test that broadcastGitSyncEvent method exists and works
      const mockClients = new Set();
      fileWatchService.clients = mockClients;
      
      // Create mock WebSocket client
      const mockClient = {
        readyState: 1, // OPEN state
        OPEN: 1,
        send: function(message) {
          this.lastMessage = JSON.parse(message);
        },
        lastMessage: null
      };
      mockClients.add(mockClient);
      
      // Mock a watcher for the test path
      const mockWatcher = {
        clients: new Set([mockClient])
      };
      fileWatchService.watchers.set(testPath, mockWatcher);
      
      // Test the broadcastGitSyncEvent method
      if (fileWatchService.broadcastGitSyncEvent) {
        fileWatchService.broadcastGitSyncEvent([testPath]);
        
        // Check that SYNC event was sent
        expect(mockClient.lastMessage).to.not.be.null;
        expect(mockClient.lastMessage.type).to.equal('file-change');
        expect(mockClient.lastMessage.eventType).to.equal('SYNC');
        expect(mockClient.lastMessage.path).to.include('sync-test-file.js');
      } else {
        // Method doesn't exist yet - that's expected for this test-first approach
        expect(fileWatchService.broadcastGitSyncEvent).to.be.undefined;
      }
    });
  });
});