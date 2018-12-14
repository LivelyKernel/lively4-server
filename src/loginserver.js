var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var os = require('os');
var pty = require('node-pty');

var terminals = {},
    logs = {};

var secrets = new Map()
secrets.set("hellolively", "jens") // symetric application key, #TODO move it to hard disk

app.use('/build', express.static(__dirname + '/../build'));

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.get('/', function(req, res){
  res.send("xterm service");
});

app.post('/create', function (req, res) {
  var shell = '/bin/login'
  var secret = req.headers.secret
  var args = []
  var user = secrets.get(secret) // the secret is the key to the user....
  var cwd = req.headers.cwd ||  process.env.PWD
  if (secret && user) {
    shell = '/bin/bash'
    args = args.concat(["-c", "su " + user]) 
  }
  var cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      // process.platform === 'win32' ? 'cmd.exe' 
      term = pty.spawn(shell, args, {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: cwd,
        env: process.env
      });

  console.log('Created terminal with PID: ' + term.pid);
  terminals[term.pid] = term;
  logs[term.pid] = '';
  term.on('data', function(data) {
    logs[term.pid] += data;
  });
  res.send(term.pid.toString());
  res.end();
});

app.post('/size/:pid', function (req, res) {
  var pid = parseInt(req.params.pid),
      cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = terminals[pid];

  term.resize(cols, rows);
  console.log('Resized terminal ' + pid + ' to ' + cols + ' cols and ' + rows + ' rows.');
  res.end();
});

app.ws('/terminal/:pid', function (ws, req) {
  var term = terminals[parseInt(req.params.pid)];
  console.log('Connected to terminal ' + term.pid);
  ws.send(logs[term.pid]);

  function buffer(socket, timeout) {
    let s = '';
    let sender = null;
    return (data) => {
      s += data;
      if (!sender) {
        sender = setTimeout(() => {
          socket.send(s);
          s = '';
          sender = null;
        }, timeout);
      }
    };
  }
  const send = buffer(ws, 5);

  term.on('data', function(data) {
    try {
      send(data);
    } catch (ex) {
      // The WebSocket is not open, ignore
    }
  });
  ws.on('message', function(msg) {
    term.write(msg);
  });
  ws.on('close', function () {
    term.kill();
    console.log('Closed terminal ' + term.pid);
    // Clean things up
    delete terminals[term.pid];
    delete logs[term.pid];
  });
});

var port = process.env.PORT || 3000,
    host = os.platform() === 'win32' ? '127.0.0.1' : '0.0.0.0';

console.log('App listening to http://' + host + ':' + port);
app.listen(port, host);
