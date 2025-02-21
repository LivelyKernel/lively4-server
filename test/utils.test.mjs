import { expect } from 'chai';
import { config, respondWithCMD } from '../src/utils.js';

describe('utils', () => {
  describe('respondWithCMD', () => {
    let mockResponse;
    
    beforeEach(() => {
      mockResponse = {
        setHeader: () => {},
        writeHead: () => {},
        write: function(data) { 
          this.output = (this.output || '') + data.toString();
        },
        end: function() { this.ended = true; },
        output: '',
        ended: false
      };
    });
    
    afterEach(() => {
      config.testMode = false;
      config.testCallback = null;
    });
    
    it('should handle test mode with mock output', async () => {
      config.testMode = true;
      config.testCallback = (cmd) => `Mocked output for: ${cmd}`;
      
      await respondWithCMD('echo "test"', mockResponse, false);
      
      expect(mockResponse.output).to.equal('Mocked output for: echo "test"');
      expect(mockResponse.ended).to.be.true;
    });

    it('should handle dry run mode', async function() {
      this.timeout(5000); // Increase timeout
      
      await respondWithCMD('echo "test"', mockResponse, true);
      
      expect(mockResponse.output).to.equal('dry run:\necho "test"');
      expect(mockResponse.ended).to.be.true;
    });
    
    it('should execute real command when not in test mode', async () => {
      await respondWithCMD('echo "real test"', mockResponse, false);
      
      expect(mockResponse.output).to.contain('real test');
      expect(mockResponse.ended).to.be.true;
    }).timeout(5000);
  });
});
