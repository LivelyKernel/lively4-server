export class MockServer {
  constructor() {
    this.lively4dir = 'test';
  }
}

export class MockResponse {
  constructor() {
    this.output = '';
    this.ended = false;
  }

  setHeader() { }

  writeHead() { }

  write(data) {
    this.output = (this.output || '') + data.toString();
  }

  end() {
    this.ended = true;
  }
}
