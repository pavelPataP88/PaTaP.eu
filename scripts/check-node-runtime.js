const { assertSupportedNode, SUPPORTED_NODE_MAJOR } = require("../runtime/node-policy");

try {
  assertSupportedNode();
  console.log(`Node runtime policy PASS: ${process.version} (required ${SUPPORTED_NODE_MAJOR}.x LTS)`);
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
