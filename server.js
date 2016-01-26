var Promise = require("bluebird"),
    fs      = require("q-io/fs"),
    nodeFs  = require("fs"),
    path    = require("path"),
    natsort = require("natural-compare-lite"),
    mime    = require("mime");

// Long promise stack traces for debugging
Promise.longStackTraces();

var argv = require("argv").option([
    {
        name: "port",
        short: "p",
        type: "int",
        description: "port on which the server will listen for connections"
    }, {
        name: "directory",
        short: "d",
        type: "path",
        description: "root directory from which the server will serve files"
    }, {
        name: "shadow",
        short: "s",
        type: "path",
        description: "if set, reads and writes go to a shadow file system"
    }
]);

var conf = Object.assign({}, {
    port: 8080,
    directory: '.',
    shadow: null
}, argv.run().options);

path.descents = function* (location) {
    var components = path.normalize(location).split(path.sep);

    for(var i = 1; i <= components.length; i++) {
        var pathname = components.slice(0, i).join(path.sep);

        if(pathname.length > 0) {
            yield pathname;
        }
    }
}

nodeFs.mkpathSync = function(location) {
    for(var dir of path.descents(location)) {
        if(!nodeFs.existsSync(dir))
            nodeFs.mkdirSync(dir);
    }
}

fs.mkpath = Promise.coroutine(function* (location) {
    for(var dir of path.descents(location)) {
        var exists = yield fs.exists(dir);

        if(!exists)
            yield fs.makeDirectory(dir);
    }
})

conf.directory = nodeFs.realpathSync(conf.directory);

if(conf.shadow) {
    nodeFs.mkpathSync(conf.shadow);
    conf.shadow = nodeFs.realpathSync(conf.shadow);
}

var permissions = Promise.coroutine(function* (location) {
    var access = yield Promise.all([
        new Promise((ok, _) => nodeFs.access(location, fs.R_OK, ok)),
        new Promise((ok, _) => nodeFs.access(location, fs.W_OK, ok))
    ]);

    return {
        read: access[0] === null,
        write: access[1] === null
    }
});

var lookup = Promise.coroutine(function* (pathname, shadow) {
    var location = path.normalize(pathname);

    if(conf.shadow) {
        var shadowLocation = path.join(conf.shadow, location);

        if(shadow) {
            return shadowLocation;
        }

        var shadowExists = yield fs.exists(shadowLocation);

        if(shadowExists) {
            return shadowLocation;
        }
    }

    return location;
});

var readfile = Promise.coroutine(function* (pathname) {
    var realPathname = path.join(conf.directory, pathname);

    if(conf.shadow) {
        var shadowPathname = path.join(conf.shadow, pathname);
        var shadowExists = yield fs.exists(shadowPathname);

        if(shadowExists) {
            return fs.read(shadowPathname);
        }
    }

    return fs.read(realPathname);
});

var writefile = Promise.coroutine(function* (pathname, content) {
    var realPathname = path.join(conf.directory, pathname);

    if(conf.shadow) {
        var shadowPathname = path.join(conf.shadow, pathname);

        var dirname = path.dirname(pathname);
        var realDirname = path.join(conf.directory, dirname);
        var shadowDirname = path.join(conf.shadow, dirname)

        var base = yield Promise.all([
            fs.exists(realDirname).then((exists) => {
                if(exists)
                    return fs.stat(realDirname);
            }),
            fs.exists(shadowDirname).then((exists) => {
                if(exists)
                    return fs.stat(shadowDirname);
            })
        ]).then((stat) => {
            return { real: stat[0], shadow: stat[1] }
        })

        if(base.shadow) {
            return fs.write(shadowPathname, content).then(() => content);
        }

        if(base.real && base.real.isDirectory() && !base.shadow) {
            yield fs.mkpath(shadowDirname);
            return fs.write(shadowPathname, content).then(() => content);
        }
    } else {
        return fs.write(pathname, content).then(() => {
            return content;
        });
    }
});

var __statinfo = Promise.coroutine(function* (realpath, pathname, recursive) {
    var stats = yield fs.stat(realpath);

    if(stats.isDirectory()) {
        var descriptor = {
            type: 'directory',
            name: path.basename(pathname)
        };

        if(recursive && recursive > 0) {
            var files = yield fs.list(realpath);

            files = files.sort(natsort);

            descriptor['contents'] = yield Promise.all(files.map((file) => {
                return statinfo(path.join(pathname, file), recursive - 1);
            }));
        }

        return descriptor;
    }

    if(stats.isFile()) {
        var access = yield permissions(realpath);

        return {
            type: 'file',
            name: path.basename(pathname),
            size: stats.size,
            access: access
        }
    }

    throw new Error('Cannot handle file type: ' + location);
})

var __list = Promise.coroutine(function* (pathname) {
    var stat = yield fs.stat(pathname);

    if(stat.isDirectory()) {
        return fs.list(pathname);
    } else {
        return [];
    }
})

var statinfo = Promise.coroutine(function* (pathname, recursive) {
    var realPathname = path.join(conf.directory, pathname);

    if(conf.shadow) {
        var shadowPathname = path.join(conf.shadow, pathname);
        var shadowExists = yield fs.exists(shadowPathname);

        if(shadowExists) {
            var shadowStats = yield fs.stat(shadowPathname);

            if(shadowStats.isFile()) {
                return __statinfo(shadowPathname, pathname, recursive);
            }

            if(shadowStats.isDirectory()) {
                // Merge content from shadow directory and
                // underlay directory.

                var children = yield Promise.all([
                    __list(shadowPathname),
                    __list(realPathname)
                ])

                children = children.reduce((a, b) => a.concat(b))
                children = children.filter((e, i) => children.indexOf(e) === i)
                children = children.sort(natsort)

                var contents = yield Promise.all(children.map((file) => {
                    return statinfo(path.join(pathname, file));
                }));

                return {
                    type: 'directory',
                    name: path.basename(pathname),
                    contents: contents
                }
            }
        }
    }

    return __statinfo(realPathname, pathname, recursive);
});

var response = Promise.coroutine(function* (status, body, options) {
    if(typeof body === 'object') {
        body = JSON.stringify(body, null, "\t");
    }

    return Object.assign({
        status: status,
        headers: {},
        body: [ body ]
    }, options)
});

require("joey")
.log()
.route(($) => {
    $('/...')
    .trap((response) => {
        response.headers = Object.assign({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Request-Method': '*',
            'Access-Control-Allow-Methods': 'HEAD, GET, POST, OPTIONS, PUT, PATCH, DELETE'
        }, response.headers)
    })
    .methods(($) => {
        $('GET').app(Promise.coroutine(function* (request) {
            try {
                var pathname = path.normalize(request.pathInfo);
                var content  = yield readfile(pathname);

                return response(200, content, {
                    headers: {
                        'Content-Type': mime.lookup(pathname)
                    }
                });
            } catch(err) {

                var status = 500,
                    json = { message: err.toString() };

                switch(err.code) {
                    case 'ENOENT':
                        status = 404;
                        break;
                    case 'EISDIR':
                        status = 400;
                        break;
                    default:
                        console.log(err.stack)
                }

                return response(status, json, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }
        }));

        $('PUT').app(Promise.coroutine(function* (request) {
            try {
                var pathname = path.normalize(request.pathInfo);
                var buffer   = yield request.body.read();
                var content  = yield writefile(pathname, buffer);

                return response(200, content, {
                    headers: {
                        'Content-Type': mime.lookup(pathname)
                    }
                });
            } catch(err) {

                var status = 500,
                    json = { message: err.toString() };

                switch(err.code) {
                    case 'EISDIR':
                        status = 400;
                        break;
                    default:
                        console.log(err.stack)
                }

                return response(status, json, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }
        }));

        $('OPTIONS').app(Promise.coroutine(function* (request) {
            if(request.headers['access-control-request-headers']) {
                // CORS preflight header must always return 200 OK
                return response(200, "")
            }

            try {
                var pathname = path.normalize(request.pathInfo);
                var descriptor = yield statinfo(pathname, 1);
                var allow = ['OPTIONS']

                if(descriptor.access) {
                    if(descriptor.access.read) {
                        allow.push('GET')
                    }
                    if(descriptor.access.write) {
                        allow.push('PUT')
                    }
                }

                return response(200, descriptor, {
                    headers: {
                        'Allow': allow.join(', '),
                        'Content-Type': 'application/json'
                    }
                })
            } catch(err) {
                var status = 500,
                    json = { message: err.toString() };

                switch(err.code) {
                    case 'ENOENT':
                        status = 404;
                        break;
                    case 'EISDIR':
                        status = 400;
                        break;
                    default:
                        console.log(err.stack)
                }

                return response(status, json, {
                    headers: {
                        'Allow': 'OPTIONS',
                        'Content-Type': 'application/json'
                    }
                })
            }
        }));
    })
}).listen(conf.port).then(() => {
    console.log("Serving `" + conf.directory + "' on port " + conf.port + "...")
})


