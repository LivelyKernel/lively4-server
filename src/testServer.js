var expect  = require("chai").expect;
var request = require("request");
var child_process = require("child_process");

var exec = child_process.exec;

process.env.NODE_ENV = 'test';

var Server = require('./httpServer');

var port = 8081

describe("Lively4 Server", function() {

  before(function(done) {
    Server.lively4dir = "tmp/"
    Server.port = port
    
    var cmd = "mkdir -v tmp; cd tmp;" +
      "git clone https://github.com/LivelyKernel/lively4-dummy;" +
      "cd lively4-dummy; git --reset hard"
    exec(cmd, (error, stdout, stderr) => {
      console.log("stdout: " + stdout);
      Server.start();
      done();
    });
  });

  describe("List Livel4 directory", function() {

    var url = "http://localhost:" + port+"/";

    it("returns status 200", function(done) {
      request(url, function(error, response, body) {
        expect(response.statusCode).to.equal(200);
        done();
      });
    });
    
    it("returns listing", function(done) {
      request(url, function(error, response, body) {
        expect(body).to.match(/lively4-dummy/);
        done();
      });
    });
    
    it("read file", function(done) {
      request(url + "lively4-dummy/README.md", function(error, response, body) {
        expect(body).to.match(/A dummy repository/);
        done();
      });
    });
  });
  
})
