import {exec} from "child_process"
import child_process from "child_process";

export var config = {
  bashBin: "bash"
}

export async function run(cmd) {
  return  new Promise((resolve) => {
    exec(cmd, {maxBuffer: 1024 * 2000}, (error, stdout, stderr) => {
      resolve({stdout, stderr, error});      
    });
  })
}

export function cleanString(str) {
  return str.replace(/[^A-Za-z0-9 ,.()\[\]#]/g,"_")
}


export function log(...args) {
  console.log(...args)
}

export async function respondWithCMD(cmd, res, dryrun) {
  return new Promise( resolve => {
    log(cmd);

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.writeHead(200);

    if (dryrun) {
      return res.end("dry run:\n" + cmd);
    }

    var process = child_process.spawn(config.bashBin, ["-c", cmd]);
    process.stdout.on('data', function (data) {
      // log('STDOUT: ' + data);
      res.write(data, undefined, function() {log("FLUSH");} );
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
