import { logRequest } from './utils.js';


// trace specific instances and sessions for debugging
export function logDebugRequest(req) {
  logRequest(req, "START " + req.method + "\t" + req.url)

  var debugInitiator = req.headers['debug-initiator'];
  if (debugInitiator) {
    logRequest(req, "INITIATOR " + debugInitiator)
  }
  var debugSession = req.headers['debug-session'];
  if (debugSession) {
    logRequest(req, "SESSION " + debugSession)
  }

  var debugSystem = req.headers['debug-system'];
  if (debugSystem) {
    logRequest(req, "SYSTEM " + debugSystem)
  }

  var debugEventid = req.headers['debug-eventid'];
  if (debugEventid) {
    logRequest(req, "EVENTID " + debugEventid)
  }
}