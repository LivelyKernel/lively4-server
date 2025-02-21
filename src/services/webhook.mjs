import { log } from '../utils.js';

import Service from "./service.mjs";


/**
 * WebHookService handles GitHub webhook registrations and notifications
 * Implements a long-polling mechanism for webhook subscribers
 * 
 * Configure webhooks at: https://github.com/LivelyKernel/lively4-core/settings/hooks
 */
export default class WebHookService extends Service {
    /**
     * Creates a new WebHookService instance
     * @param {Server} server - The server instance to attach the service to
     */
    constructor(server) {
        super(server)
    }

    /**
     * Gets or creates a Set of webhook listeners for a given repository
     * @param {string} key - Repository name to get listeners for
     * @returns {Set} Set of webhook listeners for the repository
     */
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

    /**
     * Handles webhook requests for registration and signal forwarding
     * @param {string} pathname - Request path
     * @param {http.IncomingMessage} req - HTTP request object
     * @param {http.ServerResponse} res - HTTP response object
     * @returns {Promise<void>} Resolves when webhook handling is complete
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
