const SUPPORTED_NODE_MAJOR = 24;

function parseNodeMajor(version = process.versions.node) {
  const match = String(version || "").trim().match(/^v?(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : null;
}

function isSupportedNode(version = process.versions.node) {
  return parseNodeMajor(version) === SUPPORTED_NODE_MAJOR;
}

function unsupportedNodeMessage(version = process.versions.node) {
  const actual = String(version || "unknown");
  return `Unsupported Node.js runtime ${actual}. PaTaP requires Node.js ${SUPPORTED_NODE_MAJOR}.x LTS.`;
}

function assertSupportedNode(version = process.versions.node) {
  if (!isSupportedNode(version)) {
    const error = new Error(unsupportedNodeMessage(version));
    error.code = "PATAP_UNSUPPORTED_NODE_RUNTIME";
    throw error;
  }
  return true;
}

module.exports = {
  SUPPORTED_NODE_MAJOR,
  parseNodeMajor,
  isSupportedNode,
  unsupportedNodeMessage,
  assertSupportedNode
};
