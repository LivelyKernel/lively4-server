

export default class Service {

  constructor(server) {
    this.server = server;
  }
    
  get Config() {
    return this.server.Config;
  }

  async request() {
    throw new Error("Not implemented");
  }
}