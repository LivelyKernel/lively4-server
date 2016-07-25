var gulp = require("gulp");
var babel = require("gulp-babel");
var spawn = require("child_process").spawn;
var node;
var lastTranspilationSuccessful;

gulp.task("server", ["babel"], function() {
  if (lastTranspilationSuccessful) {
    if (node) node.kill();
    node = spawn("node", ["httpServer.js", "-p", "8088", "-d", "../.."], {stdio: "inherit", cwd: "dist"});
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
