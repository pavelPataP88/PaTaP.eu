const readline = require("readline");
const {
  openDb,
  nowIso,
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePassword,
  hashPassword
} = require("./db");

const db = openDb();

function ask(query, { secret = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (!secret) {
    return new Promise((resolve) => rl.question(query, (answer) => { rl.close(); resolve(answer); }));
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    let value = "";
    process.stdout.write(query);
    function onKey(char, key) {
      if (key && key.name === "return") {
        process.stdout.write("\n");
        stdin.off("keypress", onKey);
        if (stdin.isTTY) stdin.setRawMode(false);
        rl.close();
        resolve(value);
      } else if (key && key.name === "backspace") {
        value = value.slice(0, -1);
      } else if (char && !key.ctrl && !key.meta) {
        value += char;
      }
    }
    stdin.on("keypress", onKey);
  });
}

(async () => {
  const existingOwner = db.prepare("SELECT id, username FROM users WHERE role = 'Owner' AND disabled = 0 LIMIT 1").get();
  if (existingOwner) {
    console.log(`Owner already exists: ${existingOwner.username}`);
    process.exit(0);
  }
  const username = normalizeUsername(await ask("Owner username: "));
  const email = normalizeEmail(await ask("Owner email: "));
  const password = await ask("Owner password (min 6 chars): ", { secret: true });
  const confirmPassword = await ask("Repeat owner password: ", { secret: true });
  if (!validateUsername(username)) throw new Error("Invalid username. Use 3-32 chars: lowercase letters, numbers, _ or -.");
  if (!validateEmail(email)) throw new Error("Invalid email.");
  if (!validatePassword(password)) throw new Error("Invalid password length.");
  if (password !== confirmPassword) throw new Error("Passwords do not match.");
  const now = nowIso();
  db.prepare(`
    INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
    VALUES(?, ?, ?, 'Owner', ?, ?)
  `).run(username, email, hashPassword(password), now, now);
  console.log("Owner account created.");
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
