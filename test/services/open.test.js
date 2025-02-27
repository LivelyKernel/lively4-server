import { expect } from 'chai';
import { config } from '../../src/utils.js';
import OPEN from '../../src/services/open.js';
import { MockServer, MockResponse } from '../test-utils.js';

describe('OPEN', () => {
  let mockRequest;
  let mockResponse;
  let mockServer;

  beforeEach(() => {
    mockServer = new MockServer();
    mockResponse = new MockResponse();
  });

  afterEach(() => {
    config.testMode = false;
    config.testCallback = null;
  });

  it('should handle opening a file in test mode', async () => {
    config.testMode = true;
    config.testCallback = (cmd) => `Mocked OPEN: ${cmd}`;

    await new OPEN(mockServer).request('http://foobar/_open/file.txt', mockRequest, mockResponse);

    expect(mockResponse.output).to.contain('Mocked OPEN: cd "test"; open "file.txt"');
    expect(mockResponse.ended).to.be.true;
  });

});