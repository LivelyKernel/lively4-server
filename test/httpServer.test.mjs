import fetch from 'node-fetch'
import {expect} from "chai"
import {exec} from "child_process"

// TODO: start server in a separate process
import {Server} from '../src/httpServer.mjs'

import JSZip from "jszip"
import fs from 'node:fs'

const Lively4bootfilelistName = ".lively4bootfilelist"
const Lively4bundleName = ".lively4bundle.zip"
const Lively4transpileDir = ".transpiled"
const Lively4optionsDir = ".options"

var port = 8081;

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      // if (error) reject(stderr)
      resolve({stdout, stderr, error});      
    });
  })
}

describe("Lively4 Server", () => {  
  var tmp = "tmp/";
  var testrepo = "lively4-dummy";
  var url = "http://localhost:" + port+"/";

  async function expectResultMatch(cmd, regexString) {
    var result = await run(`cd ${tmp}${testrepo};` + cmd); 
    expect(result.stdout).match(new RegExp(regexString));
  }
  
  before(async function() {
    Server.lively4dir = tmp;
    Server.port = port;
    Server.autoCommit = true;
    Server.options['tmp-cleanup-timeout'] = 1000; // Set cleanup timeout to 1s for testing
    this.timeout(35000);
    var result = await run(`rm -rv "${tmp}"; mkdir -p "${tmp}"; cd "${tmp}";` +
      `git clone https://github.com/LivelyKernel/${testrepo};` +
      `cd ${testrepo}; git reset --hard`);
    
    console.log("stdout: " + result.stdout);
    
    console.log("start server")
    Promise.resolve().then(() => Server.start());
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log("server started")
  });

  after(async () => {
    console.log("stop server")
    Server.stop();
    console.log("server stopped")
  })


  describe("GET", () => {
    it("read directory", async () => {
      var response = await fetch(url, {
        method: "GET",
      })
      var body = await response.text() 
      expect(body).to.match(/lively4-dummy/);
    });
  
    it("read file", async () => {
      var response = await fetch(url + "lively4-dummy/README.md", {
        method: "GET",
      })
      var body = await response.text() 
      expect(body).to.match(/A dummy repository/);
      expect(response.headers.get("fileversion"),"fileversion").length.gt(0)
      expect(response.headers.get("modified"),"modified").length.gt(0)
    });
    
    it("read bundle", async () => {
      var response = await fetch(url + "lively4-dummy/" + Lively4bundleName, {
        method: "GET",
      })
      var body = await response.arrayBuffer() 
      console.log("BODY " + body)
      var zip = await JSZip.loadAsync(body)
      var files = Object.keys(zip.files);

      // console.log("Bundled files:" , files)
      
      expect(files).to.include("README.md")
      expect(files).to.include("foo.js")
      expect(files).to.include(".options/foo.js")
    
    })
  })
  
  describe("PUT", () => {
    it("write file", async function() {
      var filename = 'testwrite.txt';
      var authorName = 'Joe';
      var authorEmail = "joe@lively-kernel.org";
      var content = "The test says hello!";
      var response = await fetch(url + testrepo + "/" + filename, {
        method: "PUT",
        body: content,
        headers: {
            gitusername: authorName,
            gitemail: authorEmail
        }
      })
      expect(response.status, "status").to.equal(200);
      await expectResultMatch("cat " + filename, content);
      await expectResultMatch("git status" , /nothing to commit/);
      await expectResultMatch("git log -n 1 --format='%aN' "+ filename , authorName);
      await expectResultMatch("git log -n 1 --format='%aE' " + filename, authorEmail);
    });    
  })

  describe("MKCOL", async () => {
    it("creates a directory", async () => {
      var response = await fetch(url + testrepo + "/newdir", {
        method: "MKCOL"
      })
      expect(response.status).to.equal(200);
      await expectResultMatch("ls -d newdir", "newdir\n")
    })
  })

  describe("OPTIONS", function() {
    this.timeout(2100)
    it("lively4 root directory", async () => {
      var response = await fetch(url, {
        method: "OPTIONS",
      })
      expect(response.status).to.equal(200);
    });
    it("directory", async () => {
      var response = await fetch(url + "lively4-dummy/", {
        method: "OPTIONS",
      })  
      expect(response.status).to.equal(200);
      var stats = await response.json()
      expect(stats.type).to.equal("directory");
    });

    it("directory without slash", async () => {
      var response = await fetch(url + "lively4-dummy", {
        method: "OPTIONS",
      })
      expect(response.status).to.equal(200);
    });
    
    it("should show versions", async() => {
      var response = await fetch(url + "lively4-dummy/README.md", {
        method: "OPTIONS",
        headers: {
          showversions: true
        }
      })
      var content = await response.json()
      expect(content.versions, "versions").length.to.be.gt(0)
    })
    

    it("should show versions on directories", async() => {
      var response = await fetch(url + "lively4-dummy/", {
        method: "OPTIONS",
        headers: {
          showversions: true
        }
      })
      var content = await response.json()
      expect(content.versions, "versions").length.to.be.gt(0)
    })
    
    it("should show filelist", async() => {
      var response = await fetch(url + "lively4-dummy/", {
        method: "OPTIONS",
        headers: {
          filelist: true
        }
      })
      var content = await response.json()
      expect(content.type, "type").to.be.equal("filelist")
      expect(content.contents, "contents").length.to.be.gt(0)
    })
  });
  
  describe("TMP", function() {
    it("should create tmp file", async() => {
      var filename = `${url}_tmp/foo_${Date.now()}.txt`
      var body = "hello world"
      var response = await fetch(filename, {
        method: "PUT",
        body: body
      })
      var loaded = await fetch(filename).then(r => r.text())
      expect(loaded, "tmp content").to.be.equal(body)
    })
   })

  describe("TMP Storage", function() {
    it("should cleanup tmp files after timeout", async function() {
      this.timeout(6000); // increase timeout for this test
      
      var filename = `${url}_tmp/cleanup_${Date.now()}.txt`
      

      var response = await fetch(filename)
      expect(response.status, "file " + filename + " should not exist").to.equal(404)

      var body = "test data"
      // Create tmp file
      await fetch(filename, {
        method: "PUT",
        body: body
      })
      
      // Verify file exists
      var content = await fetch(filename).then(r => r.text())
      expect(content).to.equal(body)
      
      // Wait for cleanup (original timeout is 5 minutes, but we've modified it to 1s for testing, so we need to wait longer)
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // File should be gone
      var response = await fetch(filename)
      expect(response.status).to.equal(404)
    })
    
    it("should handle concurrent tmp file access", async function() {
      var filename = `${url}_tmp/concurrent_${Date.now()}.txt`
      var iterations = 10
      
      // Create multiple concurrent requests
      var promises = Array(iterations).fill().map(async (_, i) => {
        await fetch(filename, {
          method: "PUT",
          body: `data${i}`
        })
        return fetch(filename).then(r => r.text())
      })
      
      var results = await Promise.all(promises)
      // Last write should win
      expect(results[results.length-1]).to.equal(`data${iterations-1}`)
    })
  })

  describe("Error Handling", function() {
    it("should reject paths with special characters", async function() {
      var response = await fetch(url + "lively4-dummy/test'file.txt", {
        method: "PUT",
        body: "test"
      })
      expect(response.status, "response " + await response.text()).to.equal(500)
    })
    
    it("should reject paths trying to break out of root", async function() {
      var response = await fetch(url + "../outside.txt", {
        method: "GET"
      })
      expect(response.status).to.equal(500)
    })
  })

  describe("Authorization", function() {
    it("should reject requests without credentials when auth required", async function() {
      // Temporarily enable auth requirement
      var originalAuth = Server.options["authorize-requests"]
      Server.options["authorize-requests"] = true
      
      var response = await fetch(url + "lively4-dummy/README.md", {
        method: "GET"
      })
      expect(response.status).to.equal(403)
      
      // Restore original setting
      Server.options["authorize-requests"] = originalAuth
    })
  })

  describe("Bundle", function() {
    it("should invalidate bundle after file changes", async function() {
      var bundleUrl = url + "lively4-dummy/" + Lively4bundleName
      
      // Get initial bundle
      var response1 = await fetch(bundleUrl)
      var bundle1 = await response1.arrayBuffer()
      
      // Modify a file
      await fetch(url + "lively4-dummy/README.md", {
        method: "PUT",
        body: "Modified content"
      })
      
      // Get new bundle
      var response2 = await fetch(bundleUrl)
      var bundle2 = await response2.arrayBuffer()
      
      // Bundles should be different
      expect(bundle1).to.not.deep.equal(bundle2)
    })
  })
});
