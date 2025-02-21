import { log } from '../utils.js';

export default class WebHookService {
    constructor(server) {
        this.server = server;
    }
    webhookListeners(key) {
        if (!this.webhookListeners) {
            this.webhookListeners = new Map()
        }
        var set = this.webhookListeners[key]
        if (!set) {
            set = new Set()
            this.webhookListeners[key] = set
        }
        return set
    }


    /* 
      Very basic forward of github webhooks to subscriptions...
      see https://github.com/LivelyKernel/lively4-core/settings/hooks
    */
    async request(pathname, req, res) {
        log("WEBHOOK " + req.method + ": " + pathname)

        if (req.method == 'GET' && pathname.match("/_webhook/register")) {
            let key = req.headers['repositoryname'];
            log("webhook register " + key)

            this.server.webhookListeners(key).add({
                response: res
            })
            // do not answer it... do a long poll

            // res.writeHead(200); // done
            // res.end();

        } else if ((req.method == 'PUT' || req.method == 'POST') && pathname.match("/_webhook/signal")) {

            log("webhook signal ")
            var body = '';
            req.on('data', (data) => {
                body += data;
            });
            req.on('end', () => {

                try {
                    var json = JSON.parse(body)
                } catch (e) {
                    res.writeHead(400); // done
                    res.end("could not parse: " + body);
                }
                if (json) {
                    var key = json.repository.full_name
                    var listeners = this.server.webhookListeners(key)
                    // log("found listeners: " + listeners.size)
                    Array.from(listeners).forEach(ea => {
                        var response = ea.response
                        if (response) {
                            // log("answer " + response)
                            response.writeHead(200); // answer long poll 
                            response.end(JSON.stringify(json));
                        }
                        listeners.delete(ea)
                    })
                    res.writeHead(200); // done
                    res.end("");
                }
            });
        } else {
            log("webhook: " + pathname)
            res.writeHead(200); // not 
            res.end();
        }
    }
}
