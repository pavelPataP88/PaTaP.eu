const fs = require("fs");
const path = require("path");

class FileSource {
  constructor(root) {
    this.root = root;
  }

  resolve(relativePath) {
    return path.join(this.root, relativePath);
  }

  exists(relativePath) {
    return fs.existsSync(this.resolve(relativePath));
  }

  readText(relativePath) {
    return fs.readFileSync(this.resolve(relativePath), "utf8");
  }

  readJson(relativePath) {
    return JSON.parse(this.readText(relativePath));
  }
}

module.exports = { FileSource };
