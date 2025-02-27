/**
 * @typedef {Object} OptionSpec
 * @property {string} name - The full name of the option
 * @property {string} [short] - Single-character shorthand for the option
 * @property {'int'|'path'|'string'|'boolean'} type - The data type of the option
 * @property {string} description - Detailed description of what the option does
 * @property {string} [example] - Usage example for the option
 */

/**
 * Returns the specification of all command-line options supported by the server.
 * These options can be passed when starting the server to configure its behavior.
 * @returns {OptionSpec[]} Array of option specifications
 */
export default function optionsSpec() {
  return [
    {
      name: 'port',
      short: 'p',
      type: 'int',
      description: 'port on which the server will listen for connections',
      example:
        "'node http-server.js -p 8001' or 'node http-server.js --port=8001'"
    },
    {
      name: 'directory',
      short: 'd',
      type: 'path',
      description: 'root directory from which the server will serve files',
      example:
        "'node http-server.js -d ../foo/bar' or node http-server.js --directory=../foo/bar'"
    },
    {
      name: 'server',
      type: 'path',
      description: 'directory where the server looks for its scripts',
      example: "'node http-server.js --server ~/lively4-server'"
    },
    {
      name: 'auto-commit',
      type: 'boolean',
      description: 'auto commit on every PUT file',
      example: "'node --auto-commit=true'"
    },
    {
      name: 'bash-bin',
      type: 'string',
      description: 'path to bash executable',
      example: "'node --bash-bin=\\cygwin64\\bin\\bash.exe'"
    },
    {
      name: 'authorize-requests',
      type: 'boolean',
      description: 'authorize every request by authenticating a user and checking if in github team'
    },
    {
      name: 'github-organization',
      type: 'string',
      description: 'github organization'
    },
    {
      name: 'github-team',
      type: 'string',
      description: 'github team'
    },
    {
      name: 'myurl',
      type: 'string',
      description: 'myurl from the outside...'
    },
    {
      name: 'tmp-cleanup-timeout',
      type: 'int',
      description: 'timeout in milliseconds after which temporary files are cleaned up',
      example: "'node http-server.js --tmp-cleanup-timeout=300000'"
    }
  ];
}