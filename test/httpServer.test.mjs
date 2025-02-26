import fetch from 'node-fetch'
import { expect } from "chai"
import { exec } from "child_process"

// TODO: start server in a separate process
import { Server } from '../src/httpServer.mjs'

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
      resolve({ stdout, stderr, error });
    });
  })
}

describe("Lively4 Server", () => {
  var tmp = "tmp/";
  var testrepo = "lively4-dummy";
  var url = "http://localhost:" + port + "/";
  var server

  async function expectResultMatch(cmd, regexString) {
    var result = await run(`cd ${tmp}${testrepo};` + cmd);
    expect(result.stdout).match(new RegExp(regexString));
  }

  before(async function () {
    server = new Server();
    server.setup()

    server.lively4dir = tmp;
    server.port = port;
    server.autoCommit = true;
    server.options['tmp-cleanup-timeout'] = 1000; // Set cleanup timeout to 1s for testing
    server.options['myurl'] = url;
    server.options['directory'] = server.lively4dir;
    this.timeout(35000);
    var result = await run(`rm -rv "${tmp}"; mkdir -p "${tmp}"; cd "${tmp}";` +
      `git clone https://github.com/LivelyKernel/${testrepo};` +
      `cd ${testrepo}; git reset --hard`);

    console.log("stdout: " + result.stdout);

    console.log("start server")
    Promise.resolve().then(() => {
      server.start()
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log("server started")
  });

  after(async () => {
    console.log("stop server")
    server.stop();
    console.log("server stopped")
  })

  describe("Core File Operations", () => {
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
        expect(response.headers.get("fileversion"), "fileversion").length.gt(0)
        expect(response.headers.get("modified"), "modified").length.gt(0)
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
    });

    describe("PUT", () => {
      it("write file", async function () {
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
        await expectResultMatch("git status", /nothing to commit/);
        await expectResultMatch("git log -n 1 --format='%aN' " + filename, authorName);
        await expectResultMatch("git log -n 1 --format='%aE' " + filename, authorEmail);
      });
    });

    describe("DELETE", () => {
      it("should delete a file", async () => {
        // First create a file
        const filename = 'delete_test.txt';
        await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: "test content"
        });

        // Then delete it
        const response = await fetch(url + testrepo + "/" + filename, {
          method: "DELETE"
        });
        expect(response.status).to.equal(200);

        // Verify file is gone
        const checkResponse = await fetch(url + testrepo + "/" + filename);
        expect(checkResponse.status).to.equal(404);
      });

      it("should delete associated cache files", async () => {
        const filename = 'cache_test.js';

        // Create a JS file that will generate cache files
        await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: "console.log('test');"
        });

        // Verify cache files are created
        await fetch(url + testrepo + "/" + filename); // This should trigger cache creation

        // Delete the file
        await fetch(url + testrepo + "/" + filename, {
          method: "DELETE"
        });

        // Check that cache files are also deleted
        const optionsPath = `${url}${testrepo}/${Lively4optionsDir}/${filename.replace(/\//g, "_")}`;
        const transpilePath = `${url}${testrepo}/${Lively4transpileDir}/${filename.replace(/\//g, "_")}`;

        const optionsResponse = await fetch(optionsPath);
        const transpileResponse = await fetch(transpilePath);

        expect(optionsResponse.status).to.equal(404);
        expect(transpileResponse.status).to.equal(404);
      });
    });

    describe("MOVE", () => {
      it("should move a file to a new location", async () => {
        // Create test file
        const sourceFile = 'source.txt';
        const destFile = 'destination.txt';
        const content = "move test content";

        await fetch(url + testrepo + "/" + sourceFile, {
          method: "PUT",
          body: content
        });

        // Move the file
        const response = await fetch(url + testrepo + "/" + sourceFile, {
          method: "MOVE",
          headers: {
            'destination': url + testrepo + "/" + destFile
          }
        });
        expect(response.status).to.equal(200);

        // Verify source is gone and destination has content
        const sourceResponse = await fetch(url + testrepo + "/" + sourceFile);
        expect(sourceResponse.status).to.equal(404);

        const destResponse = await fetch(url + testrepo + "/" + destFile);
        expect(destResponse.status).to.equal(200);
        expect(await destResponse.text()).to.equal(content);
      });
    });

    describe("MKCOL", async () => {
      it("creates a directory", async () => {
        var response = await fetch(url + testrepo + "/newdir", {
          method: "MKCOL"
        })
        expect(response.status).to.equal(200);
        await expectResultMatch("ls -d newdir", "newdir\n")
      })
    })

    describe("OPTIONS", function () {
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

      it("should show versions", async () => {
        var response = await fetch(url + "lively4-dummy/README.md", {
          method: "OPTIONS",
          headers: {
            showversions: true
          }
        })
        var content = await response.json()
        expect(content.versions, "versions").length.to.be.gt(0)
      })


      it("should show versions on directories", async () => {
        var response = await fetch(url + "lively4-dummy/", {
          method: "OPTIONS",
          headers: {
            showversions: true
          }
        })
        var content = await response.json()
        expect(content.versions, "versions").length.to.be.gt(0)
      })

      it("should show filelist", async () => {
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
  });

  describe("Version Control", () => {
    describe("File Version Control", () => {
      it("should retrieve specific file versions", async () => {
        const filename = 'version_test.txt';
        const content1 = "version 1";
        const content2 = "version 2";

        // Create file with first version
        await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: content1,
          headers: {
            gitusername: "Tester",
            gitemail: "test@example.com"
          }
        });

        // Get first version hash
        const v1Response = await fetch(url + testrepo + "/" + filename, {
          method: "OPTIONS",
          headers: {
            showversions: "true"
          }
        });
        const v1Data = await v1Response.json();
        const v1Hash = v1Data.versions[0].version;

        // Update file
        await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: content2,
          headers: {
            gitusername: "Tester",
            gitemail: "test@example.com"
          }
        });

        // Retrieve first version
        const response = await fetch(url + testrepo + "/" + filename, {
          headers: {
            fileversion: v1Hash
          }
        });
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal(content1);
      });
    });

    describe("GIT Operations", function () {
      it("should show git diff", async () => {
        const response = await fetch(url + "_git/diff", {
          headers: {
            'gitrepository': testrepo,
            'gitbranch': 'master',
            'gitusername': 'test',
            'gitemail': 'test@example.com',
            'gitpassword': 'test'
          }
        });
        expect(response.status).to.equal(200);
      });

      it("should handle git reset", async () => {
        const response = await fetch(url + "_git/reset", {
          headers: {
            'gitrepository': testrepo,
            'gitbranch': 'master',
            'gitusername': 'test',
            'gitemail': 'test@example.com',
            'gitpassword': 'test'
          }
        });
        expect(response.status).to.equal(200);
      });
    });
  });

  describe("Caching and Bundling", () => {
    describe("Bundle Management", function () {
      it("should invalidate bundle after file changes", async function () {
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
      });
    });

    describe("Cache Invalidation", function () {
      it("should invalidate options file when source changes", async function () {
        const filename = 'cache_invalidation_test.js';

        // Create initial file
        await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: "console.log('test');"
        });

        // Get initial options
        const optionsPath = `${url}${testrepo}/${Lively4optionsDir}/${filename}`;
        const response1 = await fetch(optionsPath);
        const options1 = await response1.json();

        // Wait a moment to ensure different timestamp
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Modify file
        await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: "console.log('modified');"
        });

        // Check that options were updated
        const response2 = await fetch(optionsPath);
        const options2 = await response2.json();

        expect(options2.modified).to.not.equal(options1.modified);
        expect(options2.version).to.not.equal(options1.version);
      });
    });
  });

  describe("Temporary Storage", () => {
    describe("TMP", () => {
      it("should create tmp file", async () => {
        var filename = `${url}_tmp/foo_${Date.now()}.txt`
        var body = "hello world"
        var response = await fetch(filename, {
          method: "PUT",
          body: body
        })
        var loaded = await fetch(filename).then(r => r.text())
        expect(loaded, "tmp content").to.be.equal(body)
      })
    });

    describe("TMP Storage", function () {
      it("should cleanup tmp files after timeout", async function () {
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

        // Wait for cleanup (original timeout is 5 minutes, but we've modified it to 1s for testing)
        await new Promise(resolve => setTimeout(resolve, 2000))

        // File should be gone
        var response = await fetch(filename)
        expect(response.status).to.equal(404)
      })

      it("should handle concurrent tmp file access", async function () {
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
        expect(results[results.length - 1]).to.equal(`data${iterations - 1}`)
      })
    })
  });

  describe("Security", () => {
    describe("Authorization", function () {
      it("should reject requests without credentials when auth required", async function () {
        // Temporarily enable auth requirement
        var originalAuth = server.options["authorize-requests"]
        server.options["authorize-requests"] = true

        var response = await fetch(url + "lively4-dummy/README.md", {
          method: "GET"
        })
        expect(response.status).to.equal(403)

        // Restore original setting
        server.options["authorize-requests"] = originalAuth
      })
    });

    describe("Path Validation", () => {
      it("should reject paths with dangerous characters", async () => {
        const dangerousPaths = [
          "test;rm -rf.txt",
          "test|echo hack.txt",
          // "test?query=bad.txt",
          // "test#fragment.txt",
          "test'quote.txt"
        ];

        for (const path of dangerousPaths) {
          const response = await fetch(url + testrepo + "/" + path, {
            method: "PUT",
            body: "test"
          });
          expect(response.status, `Path ${path} should be rejected`).to.equal(500);
        }
      });

      it("should reject directory traversal attempts", async () => {
        const traversalPaths = [
          "../outside.txt",
          "subdir/../../../etc/passwd",
          "test/.//../secret.txt"
        ];

        for (const path of traversalPaths) {
          const response = await fetch(url + testrepo + "/" + path);
          expect(response.status, `Path ${path} should be rejected`).to.equal(404);
        }
      });
    });

    describe("Path Validation Edge Cases", function () {
      it("should handle unicode characters in paths", async () => {
        const filename = 'test-😊.txt';
        const content = "Unicode test content";

        const putResponse = await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: content
        });
        expect(putResponse.status).to.equal(200);

        const getResponse = await fetch(url + testrepo + "/" + filename);
        expect(getResponse.status).to.equal(200);
        expect(await getResponse.text()).to.equal(content);
      });

      it("should handle very long paths", async () => {
        const longPath = "a".repeat(255) + ".txt";
        const response = await fetch(url + testrepo + "/" + longPath, {
          method: "PUT",
          body: "test"
        });
        // Most filesystems have a path length limit
        expect(response.status).to.equal(500);
      });

      it("should handle spaces in paths", async () => {
        const filename = 'test with spaces.txt';
        const content = "content with spaces";

        const putResponse = await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: content
        });
        expect(putResponse.status).to.equal(200);

        const getResponse = await fetch(url + testrepo + "/" + filename);
        expect(getResponse.status).to.equal(200);
        expect(await getResponse.text()).to.equal(content);
      });
    });

    describe("Error Handling", function () {
      it("should reject paths with special characters", async function () {
        var response = await fetch(url + "lively4-dummy/test'file.txt", {
          method: "PUT",
          body: "test"
        })
        expect(response.status, "response " + await response.text()).to.equal(500)
      })

      it("should reject paths trying to break out of root", async function () {
        var response = await fetch(url + "../outside.txt", {
          method: "GET"
        })
        expect(response.status).to.equal(404)
      })
    });
  });

  describe("External Services", () => {
    describe("GRAPHVIZ", function () {
      it("should generate SVG from DOT file", async () => {
        const dotContent = `digraph { a -> b }`;
        const response = await fetch(url + "_graphviz/test", {
          method: "POST",
          body: dotContent,
          headers: {
            'graphlayout': 'dot'
          }
        });
        expect(response.status).to.equal(200);
        const svg = await response.text();
        expect(svg).to.include('<svg');
      });

      it("should handle different layout engines", async () => {
        const dotContent = `digraph { a -> b }`;
        const layouts = ['neato', 'fdp', 'circo'];

        for (const layout of layouts) {
          const response = await fetch(url + "_graphviz/test", {
            method: "POST",
            body: dotContent,
            headers: {
              'graphlayout': layout
            }
          });
          expect(response.status).to.equal(200);
          const svg = await response.text();
          expect(svg).to.include('<svg');
        }
      });
    });

    describe("CURL", function () {
      it("should fetch external resources", async () => {
        const response = await fetch(url + "_curl/?target=https://example.com");
        expect(response.status).to.equal(200);
        const body = await response.text();
        expect(body).to.include('<!doctype html>');
      });

      it("should handle missing target parameter", async () => {
        const response = await fetch(url + "_curl/");
        expect(response.status).to.equal(300);
      });
    });

    describe("SEARCH", function () {
      before(async function () {
        // Create test files for searching
        await fetch(url + testrepo + "/searchtest1.txt", {
          method: "PUT",
          body: "test content to search"
        });
        await fetch(url + testrepo + "/searchtest2.txt", {
          method: "PUT",
          body: "different content"
        });
      });

      it("should search files for pattern", async () => {
        const response = await fetch(url + "_search/files", {
          headers: {
            'searchpattern': 'test content',
            'rootdirs': 'lively4-dummy',
            'excludes': 'node_modules'
          }
        });
        expect(response.status).to.equal(200);
        const results = await response.text();
        expect(results).to.include('searchtest1.txt');
        expect(results).to.not.include('searchtest2.txt');
      });
    });
  });

  describe("System Reliability", () => {
    describe("Concurrent Operations", function () {
      it("should handle concurrent file modifications", async function () {
        const filename = 'concurrent_test.txt';
        const iterations = 5;

        // Create multiple concurrent requests
        const promises = Array(iterations).fill().map((_, i) =>
          fetch(url + testrepo + "/" + filename, {
            method: "PUT",
            body: `content${i}`
          })
        );

        await Promise.all(promises);

        // Verify final content
        const response = await fetch(url + testrepo + "/" + filename);
        const content = await response.text();
        expect(content).to.match(/content[0-4]/);
      });

      it("should handle concurrent directory operations", async function () {
        const dirname = 'concurrent_dir_test';
        const iterations = 3;

        // Create and delete directory concurrently
        const promises = Array(iterations).fill().map((_, i) =>
          Promise.all([
            fetch(url + testrepo + "/" + dirname + i, {
              method: "MKCOL"
            }),
            fetch(url + testrepo + "/" + dirname + (i - 1), {
              method: "DELETE"
            })
          ])
        );

        await Promise.all(promises);

        // Verify final state
        const response = await fetch(url + testrepo + "/" + dirname + (iterations - 1));
        expect(response.status).to.equal(200);
      });
    });

    describe("Error Recovery", function () {
      it("should handle interrupted file operations", async function () {
        const filename = 'interrupted_test.txt';

        // Start a PUT request but don't send the complete body
        const controller = new AbortController();
        const putPromise = fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: "test content",
          signal: controller.signal
        });

        // Abort the request
        controller.abort();

        try {
          await putPromise;
        } catch (e) {
          // Expected abort error
        }

        // Verify we can still perform operations
        const response = await fetch(url + testrepo + "/" + filename, {
          method: "PUT",
          body: "new content"
        });
        expect(response.status).to.equal(200);
      });
    });

    describe("Server Configuration", function () {
      it("should respect tmp-cleanup-timeout setting", async function () {
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

        // Wait for cleanup (original timeout is 5 minutes, but we've modified it to 1s for testing)
        await new Promise(resolve => setTimeout(resolve, 2000))

        // File should be gone
        var response = await fetch(filename)
        expect(response.status).to.equal(404)
      });

      it("should handle concurrent tmp file access", async function () {
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
        expect(results[results.length - 1]).to.equal(`data${iterations - 1}`)
      });
    });
  });
});
