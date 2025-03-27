import { exec } from "child_process"
import child_process from "child_process";
import fs from 'fs';

export var config = {
  bashBin: "bash",
  testMode: false,
  testCallback: null
}

export async function run(cmd) {
  return new Promise((resolve) => {
    // our file lists can get really long, so we need to increase the buffer size
    exec(cmd, { maxBuffer: 1024 * 2000 * 100 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error });
    });
  })
}

export function cleanString(str) {
  return str.replace(/[^A-Za-z0-9 ,.()\[\]#]/g, "_")
}

import { promisify } from 'util';


export async function respondWithCMD(cmd, res, dryrun) {
  return new Promise(resolve => {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.writeHead(200);

    if (config.testMode && config.testCallback) {
      const output = config.testCallback(cmd);
      res.write(output);
      res.end();
      return resolve();
    }

    if (dryrun) {
      res.write("dry run:\n" + cmd);
      res.end();
      return resolve();
    }


    var process = child_process.spawn(config.bashBin, ["-c", cmd]);
    process.stdout.on('data', function (data) {
      // log('STDOUT: ' + data);
      res.write(data, undefined, function () {
        // log("FLUSH");
      });
    });

    process.stderr.on('data', function (data) {
      log('stderr: ' + data);
      res.write(data);
    });

    process.on('close', function (code) {
      res.end();
      resolve();
    });
  })
}

// Promisified fs functions
export const fs_exists = async (file) => {
  return (await try_fs_stat(file)) !== null;
};
export const fs_stat = promisify(fs.stat);
export const fs_readdir = promisify(fs.readdir);
export const fs_writeFile = promisify(fs.writeFile);
export const fs_readFile = promisify(fs.readFile);



// Logging functions
export function log(...args) {
  console.log('[server]', ...args);
}

// #UseCase #ContextJS #AsyncContext it is really hard to hand down the request object into all methods, just so they can log properly...
export function logRequest(req, ...args) {
  log("REQUEST[" + req._logId + "] ", ...args);
}

// Helper functions
export async function try_fs_stat(file) {
  try {
    return await fs_stat(file)
  } catch (e) {
    return null
  }
}