import { expect } from 'chai';
import { config } from '../../src/utils.js';
import { MockServer, MockRequest, MockResponse } from '../test-utils.js';

import FileService from '../../src/services/files.js';


describe('File', () => {
  let mockRequest;
  let mockResponse;
  let mockServer;

  beforeEach(() => {
    mockRequest = new MockRequest();
    mockServer = new MockServer();
    mockResponse = new MockResponse();
  });

  afterEach(() => {
    config.testMode = false;
    config.testCallback = null;
  });

  describe("readFile", () => {

    it('should should handle non existent files', async () => {

      await new FileService(mockServer).readFile('test', 'non-existent-file.txt', mockRequest, mockResponse);

      expect(mockResponse.status).to.equal(404);
      expect(mockResponse.ended).to.be.true;
    });

    // if ('should read a file', async () => {
    //   await new FileService(mockServer).readFile('test', 'file.txt', mockRequest, mockResponse);

    //   expect(mockResponse.status).to.equal(200);
    //   expect(mockResponse.ended).to.be.true;
    //   expect(mockResponse.output).to.equal('file contents');


    // })
  })
})