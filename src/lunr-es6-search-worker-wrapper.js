var rootUrl = "../../lively4-core/";
importScripts( rootUrl + 'src/external/system.src.js', rootUrl + 'src/external/lunr.js');
importScripts(rootUrl + 'vendor/regenerator-runtime.js');
importScripts(rootUrl + 'vendor/babel-browser.js');
importScripts(rootUrl + 'vendor/es6-module-loader-dev.js');

System.transpiler = 'babel'
System.babelOptions = {stage: 0, optional: ['es7.doExpressions']}
System.import('./lunr-es6-search-worker.js')