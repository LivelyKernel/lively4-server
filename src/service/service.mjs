

export default class Service {

  constructor(server) {
    this.server = server;
  }
    
  async request() {
    throw new Error("Not implemented");
  }
}