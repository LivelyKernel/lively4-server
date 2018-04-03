process.env.NODE_ENV = 'test';

import fetch from 'node-fetch'
import chai from "chai"
import request from "request"
import child_process from "child_process"
import {expect} from "chai"
import {exec} from "child_process"
import Server from './httpServer.js'

var port = 8081;

describe("Lively4 Server", () => {
  
  var tmp = "tmp/";
  var testrepo = "lively4-dummy";
  var url = "http://localhost:" + port+"/";
  
  before(function(done) {
    Server.lively4dir = tmp;
    Server.port = port;
    Server.autoCommit = true
    this.timeout(35000);
    var cmd = `rm -rv "${tmp}"; mkdir -v "${tmp}"; cd "${tmp}";` +
      `git clone https://github.com/LivelyKernel/${testrepo};` +
      `cd ${testrepo}; git --reset hard`;
    exec(cmd, (error, stdout, stderr) => {
      console.log("stdout: " + stdout);
      Server.start();
      done();
    });
  });

  describe("mkcol", () => {
    it("creates a directory", (done) => {
      request({
        method: "MKCOL",
        url: url + testrepo + "/newdir"
      }, async (error, response, body) => {
        expect(response.statusCode).to.equal(200);
        await expectResultMatch("ls -d newdir", "newdir\n")
        done();
      });
    })

  })

  describe("List Lively4 directory", () => {

    it("returns status 200", (done) => {
      request(url, (error, response, body) => {
        expect(response.statusCode).to.equal(200);
        done();
      });
    });
    
    it("returns listing", (done) => {
      request(url, (error, response, body) => {
        expect(body).to.match(/lively4-dummy/);
        done();
      });
    });
    
    it("read file", (done) => {
      request(url + "lively4-dummy/README.md", (error, response, body) => {
        expect(body).to.match(/A dummy repository/);
        done();
      });
    });
  });

  describe("List options", () => {
    it("list options of directory", async () => { // async functions do not need "done" any more...
      var response = await fetch(url + "lively4-dummy/", {
        method: "OPTIONS",
      })  
      expect(response.status).to.equal(200);
      var stats = await response.json()
      expect(stats.type).to.equal("directory");
    });

    it("list options of directory without slash", async () => { // async functions do not need "done" any more...
      var response = await fetch(url + "lively4-dummy", {
        method: "OPTIONS",
      })
      expect(response.status).to.equal(200);
    });
  });
  
  function expectResultMatch(cmd, regexString) {
    return new Promise((resolve, reject) => {
      cmd =`cd ${tmp}${testrepo};` + cmd; 
      // console.log("run: " + cmd)
      exec(cmd, (error, stdout, stderr) => {
        expect(stdout).match(new RegExp(regexString));
        resolve();
      });
    });
  }
  
  it("write file", function(done) {
    var filename = 'testwrite.txt';
    var authorName = 'Joe';
    var authorEmail = "joe@lively-kernel.org";
    var content = "The test says hello!";
    request.put({
      url: url + testrepo + "/" + filename,
      body: content,
      headers: {
          gitusername: authorName,
          gitemail: authorEmail
      }
    }, async (error, response, body) => {
      if (error) return done(error);
      await expectResultMatch("cat " + filename, content);
      await expectResultMatch("git status" , /nothing to commit/);
      await expectResultMatch("git log -n 1 --format='%aN' "+ filename , authorName);
      await expectResultMatch("git log -n 1 --format='%aE' " + filename, authorEmail);
      done()
    });
  });
});
