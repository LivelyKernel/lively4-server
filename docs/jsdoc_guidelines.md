# JSDoc Guidelines for Lively4 Server

This document outlines our standards for using JSDoc to document code in the Lively4 Server project.

## Basic Requirements

- All public functions, methods, and classes should be documented
- Include descriptions for parameters and return values
- Document thrown errors when applicable

## JSDoc Block Format

```js
/**
 * Brief description of what the function does
 *
 * @param {Type} paramName - Description of the parameter
 * @returns {Type} Description of the return value
 * @throws {ErrorType} Description of when this error is thrown
 * @example
 * // Example of how to use the function
 * const result = myFunction('example');
 */
```

## Common Tags

- `@async` - Indicates the function returns a Promise
- `@param` - Documents a parameter
- `@returns` - Documents the return value
- `@throws` - Documents errors that might be thrown
- `@example` - Provides an example of usage
- `@see` - References related documentation
- `@deprecated` - Marks code as deprecated
- `@since` - Indicates when the feature was added

## Example for Different Types

### Functions

```js
/**
 * Serves a file from the filesystem
 *
 * @async
 * @param {string} path - Path to the file
 * @param {Object} options - Server options
 * @param {boolean} options.cache - Whether to use cache
 * @returns {Promise<Buffer>} File contents
 * @throws {Error} If the file doesn't exist
 */
async function serveFile(path, options = {}) {
  // Implementation
}
```

### Classes

```js
/**
 * Represents an HTTP server
 * 
 * @class
 */
class Server {
  /**
   * Create a new server
   *
   * @param {number} port - Port to listen on
   */
  constructor(port) {
    // Implementation
  }
  
  /**
   * Start the server
   * 
   * @returns {Promise<void>} Resolves when server is running
   */
  async start() {
    // Implementation
  }
}
```

## Generating Documentation

Run `npm run docs` to generate HTML documentation from JSDoc comments.
