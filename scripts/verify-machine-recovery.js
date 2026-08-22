const path = require("node:path");
const { verifyMachineRecoverySet } = require("../server/recovery/machine-dr");

async function main() {
  const setDir = process.argv[2] || process.env.PATAP_MACHINE_DR_SET_DIR;
  if (!setDir) throw new Error("Provide recovery set path or set PATAP_MACHINE_DR_SET_DIR");
  const result = await verifyMachineRecoverySet(path.resolve(setDir), {
    keyFile: process.env.PATAP_DR_KEY_FILE,
    passphrase: process.env.PATAP_DR_PASSPHRASE
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
