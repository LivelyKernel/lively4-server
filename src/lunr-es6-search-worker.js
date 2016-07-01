'use strict'

import SearchWorker from './lunr-search-worker.js';
import * as cp from "../../lively4-core/src/client/search/lunr-dropbox-content-provider.js"
// import * as utils from "./search-utils.js";

export default class ES6SearchWorker extends SearchWorker {

    constructor() {
      super();
      onmessage = this.messageHandler.bind(this);
      // utils.ensureLunr();
      // this.lunr = window.lunr;
      this.lunr = lunr;
      this.cp = cp;
    }

    send(message) {
      postMessage(message);
    }

    exit() {
      close();
    }

    log(string) {
      console.log(string);
    }
}

let worker = new ES6SearchWorker();
