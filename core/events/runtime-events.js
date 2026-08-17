class RuntimeEvents {
  constructor() {
    this.events = [];
  }

  record(type, payload = {}) {
    const event = {
      type,
      payload,
      time: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  list() {
    return [...this.events];
  }
}

module.exports = { RuntimeEvents };
