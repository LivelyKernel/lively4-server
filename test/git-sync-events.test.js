import { expect } from 'chai';
import GITService from '../src/services/git.js';

describe('Git Sync Events', function () {
  let gitService;

  beforeEach(function () {
    // Create a mock server object
    const mockServer = {
      lively4dir: '/tmp',
      fileWatchService: {
        broadcastGitSyncEvent: function(files) {
          this.lastSyncedFiles = files;
        },
        lastSyncedFiles: []
      }
    };
    
    gitService = new GITService();
    gitService.server = mockServer;
  });

  describe('parseGitStatus', function () {
    it('should parse git status --porcelain output correctly', function () {
      const statusOutput = ` M file1.js
 A file2.js
 D file3.js
?? file4.js`;
      
      const repositoryPath = '/tmp/test-repo';
      const result = gitService.parseGitStatus(statusOutput, repositoryPath);
      
      expect(result).to.deep.equal([
        '/tmp/test-repo/file1.js',
        '/tmp/test-repo/file2.js', 
        '/tmp/test-repo/file3.js',
        '/tmp/test-repo/file4.js'
      ]);
    });

    it('should handle empty git status output', function () {
      const result = gitService.parseGitStatus('', '/tmp/test-repo');
      expect(result).to.deep.equal([]);
    });

    it('should handle null git status output', function () {
      const result = gitService.parseGitStatus(null, '/tmp/test-repo');
      expect(result).to.deep.equal([]);
    });
  });

  describe('findSyncedFiles', function () {
    it('should identify files that changed from dirty to clean', function () {
      const preSync = {
        uncommitted: ['/tmp/repo/file1.js', '/tmp/repo/file2.js'],
        unpushed: ['/tmp/repo/file3.js']
      };
      
      const postSync = {
        uncommitted: ['/tmp/repo/file2.js'], // file1.js was committed
        unpushed: [] // file3.js was pushed
      };
      
      const result = gitService.findSyncedFiles(preSync, postSync, 'test-repo');
      
      // Files that were dirty before but clean after
      expect(result).to.include('/tmp/repo/file1.js');
      expect(result).to.include('/tmp/repo/file3.js');
      expect(result).to.not.include('/tmp/repo/file2.js'); // still dirty
    });

    it('should return empty array when no files changed status', function () {
      const preSync = {
        uncommitted: ['/tmp/repo/file1.js'],
        unpushed: ['/tmp/repo/file2.js']
      };
      
      const postSync = {
        uncommitted: ['/tmp/repo/file1.js'],
        unpushed: ['/tmp/repo/file2.js']
      };
      
      const result = gitService.findSyncedFiles(preSync, postSync, 'test-repo');
      expect(result).to.deep.equal([]);
    });

    it('should handle empty pre/post sync states', function () {
      const result = gitService.findSyncedFiles(
        { uncommitted: [], unpushed: [] },
        { uncommitted: [], unpushed: [] },
        'test-repo'
      );
      expect(result).to.deep.equal([]);
    });
  });
});