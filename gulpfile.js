var gulp = require("gulp");
var babel = require("gulp-babel");

var mocha = require('gulp-mocha');
var batch = require('gulp-batch');


var spawn = require("child_process").spawn;
var exec = require("child_process").exec;
var gulpexec = require('gulp-exec');

var node;
var lastTranspilationSuccessful;

gulp.task("server", ["babel"], function() {
  if (lastTranspilationSuccessful) {
    if (node) node.kill();
    node = spawn("node", (["dist/httpServer.js"]).concat(process.argv.slice(2)), {stdio: "inherit"});
    node.on("close", function (code) {
      if (code === 8) {
        gulp.log("Error detected, waiting for changes...");
      }
    });
  }
});

gulp.task("babel", function () {
  // don't end the watch task if the transpilation fails
  var b = babel({});
  lastTranspilationSuccessful = true;
  b.on("error", function (e) {
    console.log(e.stack);
    lastTranspilationSuccessful = false;
    b.end();
  });
  return gulp.src("src/**/*.js")
    .pipe(b)
    .pipe(gulp.dest("dist"));
});

gulp.task("prod", function() {
  gulp.run(["babel", "server"]);
});

gulp.task("watch", function() {
  gulp.run(["babel", "server"]);
  gulp.watch("src/**/*.js", ["babel", "server"]);
});

gulp.task("default", ["prod"]);

// gulp.task("mocha", function() {
//   console.log("mocha")
//   gulp.watch(['dist/**'], batch(function (events, cb) {
//     return gulp.src(['dist/test*.js'])
//       //.pipe(mocha({ reporter: 'list' }))
//       .pipe(each(function(content, file, callback) {
//         console.log("changed " + file) 
//         exec("echo " + file, (stdout) => {
//           callback()
//         })
//       }))
//       .on('error', function (err) {
//         console.log(err.stack);
//       });
//   }));
// })

 
gulp.task('mocha', function() {
  var options = {
    continueOnError: true, // default = false, true means don't emit error event
    pipeStdout: false, // default = false, true means stdout is written to file.contents
  };
  var reportOptions = {
    err: true, // default = true, false means don't write err
    stderr: true, // default = true, false means don't write stderr
    stdout: true // default = true, false means don't write stdout
  }
  return gulp.src('./dist/test*js')
    .pipe(gulpexec('./node_modules/mocha/bin/mocha <%= file.path %>', options)) 
    .pipe(gulpexec.reporter(reportOptions));
});

gulp.task('test', function() {
  gulp.watch("src/**/*.js", ["babel"]);
  gulp.watch("dist/**/*.js", ["mocha"]);
})


  