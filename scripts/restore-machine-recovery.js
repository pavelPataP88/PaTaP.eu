const path = require("node:path");
const { restoreMachineRecovery, defaultTunnelTokenPath } = require("../server/recovery/machine-dr");

async function main() {
  const setDir = process.argv[2] || process.env.PATAP_MACHINE_DR_SET_DIR;
  const targetRoot = process.env.PATAP_RECOVERY_TARGET_ROOT;
  if (!setDir) throw new Error("Provide recovery set path or set PATAP_MACHINE_DR_SET_DIR");
  if (!targetRoot) throw new Error("Set PATAP_RECOVERY_TARGET_ROOT to the checked-out safe snapshot directory");
  const result = await restoreMachineRecovery({
    setDir: path.resolve(setDir),
    targetRoot: path.resolve(targetRoot),
    tunnelTokenTarget: process.env.PATAP_RECOVERY_TUNNEL_TOKEN_TARGET || defaultTunnelTokenPath(),
    keyFile: process.env.PATAP_DR_KEY_FILE,
    passphrase: process.env.PATAP_DR_PASSPHRASE,
    confirm: process.env.PATAP_MACHINE_RECOVERY_CONFIRM
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
