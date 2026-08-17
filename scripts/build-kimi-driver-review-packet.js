const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "KIMI_DRIVER_PATAP_REVIEW.md");
const files = [
  "docs/DRIVER_PATAP_V1.md",
  "docs/ARCHITECTURE.md",
  "docs/DRIVER_PATAP_DECISIONS.md",
  "driver/index.html",
  "driver/styles.css",
  "driver/app.js",
  "driver/module-registry.json",
  "driver/shared/api.js",
  "driver/core/navigation.js",
  "driver/core/module-loader.mjs",
  "driver/map/index.js",
  "driver/gps/index.js",
  "driver/chat/index.js",
  "driver/radio/index.js",
  "driver/profile/index.js",
  "driver/contacts/index.js",
  "driver/driver-card/index.js",
  "server/auth/server.js",
  "server/auth/db.js",
  "server/driver/routes.js",
  "server/driver/location.js",
  "server/driver/profile.js",
  "server/chat/routes.js",
  "server/chat/repository.js",
  "server/radio/routes.js",
  "server/radio/repository.js",
  "Caddyfile.tunnel",
  "tests/auth/api.test.js",
  "tests/browser/client-storage.test.js",
  "tests/driver/module-loader.test.mjs"
];

const header = `# Driver Patap — пакет для технического ревью\n\n` +
  `Этот файл собран из актуальных исходников проекта для анализа сторонним AI.\n\n` +
  `## Задача ревью\n\n` +
  `Проанализируй Driver Patap как мобильный сервис для водителей: обязательный GPS, карта активных водителей, контакты и блокировки, общий/личный чат, голосовая рация. Не придумывай отсутствующие функции. Не предлагай полный редизайн, удаление GPS, ограничение карты только контактами или отдельную функцию помощи.\n\n` +
  `Предложения раздели на: критично исправить, полезно для закрытого теста, идеи после обратной связи. Учитывай плохую связь, мобильное использование одной рукой, конфиденциальность и международных водителей.\n\n` +
  `## Что намеренно исключено\n\n` +
  `База пользователей, email, пароли, токены Cloudflare, секреты авторизации, журналы, резервные копии, node_modules и .git.\n\n` +
  `## Содержимое\n\n` + files.map((file) => `- \`${file}\``).join("\n") + "\n\n---\n";

const chunks = [header];
for (const relative of files) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Missing review file: ${relative}`);
  const extension = path.extname(relative).slice(1) || "text";
  chunks.push(`\n\n# FILE: ${relative}\n\n\`\`\`${extension}\n${fs.readFileSync(absolute, "utf8")}\n\`\`\`\n`);
}

fs.writeFileSync(output, chunks.join(""), "utf8");
const bytes = fs.statSync(output).size;
if (bytes > 4 * 1024 * 1024) throw new Error(`Review packet is too large: ${bytes} bytes`);
console.log(JSON.stringify({ output: path.basename(output), bytes, files: files.length }));
