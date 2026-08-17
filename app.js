const storageKeys = {
  projects: "patapLabProjects",
  notes: "patapLabNotes",
  research: "patapLabResearch",
  settings: "patapLabSettings"
};
const legacyStorageMigrationKey = "patapLabLegacyStorageMigrationV1";

const authScreen = document.querySelector("#auth-screen");
const labScreen = document.querySelector("#lab-screen");
const guestScreen = document.querySelector("#guest-screen");
const authMessage = document.querySelector("#auth-message");
const currentUser = document.querySelector("#current-user");
const settingsForm = document.querySelector("#settings-form");
const adminNavButton = document.querySelector("#admin-nav-button");
const adminSummary = document.querySelector("#admin-summary");
const adminUsers = document.querySelector("#admin-users");
const adminAudit = document.querySelector("#admin-audit");
const guestLoginButton = document.querySelector("#guest-login-button");

let currentSession = null;
let csrfToken = null;

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function userStorageKey(key, user = currentSession) {
  if (!user || user.id === undefined || user.id === null || String(user.id).length === 0) {
    throw new Error("A stable user.id is required for client storage");
  }
  return `${key}:user:${encodeURIComponent(String(user.id))}`;
}

function migrateLegacyStorage(user) {
  userStorageKey(storageKeys.settings, user);
  const userId = String(user.id);
  let migration = readJson(legacyStorageMigrationKey, null);

  if (!migration) {
    migration = { version: 1, userId, completed: false };
    writeJson(legacyStorageMigrationKey, migration);
    migration = readJson(legacyStorageMigrationKey, null);
  }

  // A claimed migration can only be completed by the user who first claimed it.
  if (!migration || migration.version !== 1 || migration.userId !== userId || migration.completed) return;

  for (const key of Object.values(storageKeys)) {
    const legacyValue = localStorage.getItem(key);
    if (legacyValue === null) continue;

    const targetKey = userStorageKey(key, user);
    if (localStorage.getItem(targetKey) === null) {
      localStorage.setItem(targetKey, legacyValue);
    }
    if (localStorage.getItem(targetKey) !== null) {
      localStorage.removeItem(key);
    }
  }

  writeJson(legacyStorageMigrationKey, { ...migration, completed: true });
}

function readSettings() {
  const settings = readJson(userStorageKey(storageKeys.settings), {});
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
}

function displayNameFor(user, settings) {
  const name = typeof settings.name === "string" ? settings.name.trim() : "";
  return name || user.username || "";
}

function renderCurrentUser(user, settings) {
  currentUser.textContent = `${displayNameFor(user, settings)} · ${user.role}`;
}

function clearMessage() {
  authMessage.textContent = "";
  authMessage.classList.remove("success");
  authMessage.classList.add("hidden");
}

function setMessage(text, success = false) {
  authMessage.textContent = text;
  authMessage.classList.toggle("success", success);
  authMessage.classList.toggle("hidden", text.length === 0);
}

async function api(path, options = {}, retryCsrf = true) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    ...options.headers
  };
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (retryCsrf && response.status === 403 && data.error === "csrf_failed" && path !== "/api/csrf") {
      csrfToken = null;
      await ensureCsrf();
      return api(path, options, false);
    }
    const error = new Error(data.error || "request_failed");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}

async function ensureCsrf() {
  if (!csrfToken) {
    const data = await api("/api/csrf");
    csrfToken = data.csrfToken;
  }
}

function isAdmin(user) {
  return user && (user.role === "Owner" || user.role === "Administrator");
}

function showAuth() {
  currentSession = null;
  guestScreen.classList.add("hidden");
  labScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  adminNavButton.classList.add("hidden");
  guestLoginButton.classList.add("hidden");
}

function showLab(user) {
  clearMessage();
  currentSession = user;
  guestScreen.classList.add("hidden");
  migrateLegacyStorage(user);
  authScreen.classList.add("hidden");
  labScreen.classList.remove("hidden");
  const settings = readSettings();
  renderCurrentUser(user, settings);
  settingsForm.elements.name.value = displayNameFor(user, settings);
  settingsForm.elements.compact.checked = Boolean(settings.compact);
  document.body.classList.toggle("compact", Boolean(settings.compact));
  adminNavButton.classList.toggle("hidden", !isAdmin(user));
  guestLoginButton.classList.add("hidden");
  renderAllLists();
  if (isAdmin(user)) loadAdmin().catch(() => {});
}

function showGuest() {
  currentSession = null;
  clearMessage();
  authScreen.classList.add("hidden");
  labScreen.classList.add("hidden");
  guestScreen.classList.remove("hidden");
  adminNavButton.classList.add("hidden");
  guestLoginButton.classList.remove("hidden");
}

function switchAuthMode(mode) {
  document.querySelectorAll(".auth-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });
  document.querySelectorAll(".auth-form").forEach((form) => {
    form.classList.toggle("hidden", form.dataset.form !== mode);
  });
  clearMessage();
}

function switchSection(section) {
  if (section === "admin" && !isAdmin(currentSession)) return;
  document.querySelectorAll(".section-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === section);
  });
  document.querySelectorAll(".section-view").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === section);
  });
  if (section === "admin") loadAdmin().catch((error) => setMessage(`Админ-зона недоступна: ${error.message}`));
}

document.querySelectorAll(".auth-tab").forEach((button) => {
  button.addEventListener("click", () => switchAuthMode(button.dataset.authMode));
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await ensureCsrf();
    const data = await api("/api/login", {
      method: "POST",
      body: {
        identifier: form.elements.identifier.value.trim(),
        password: form.elements.password.value
      }
    });
    form.reset();
    showLab(data.user);
  } catch {
    setMessage("Не удалось войти. Проверьте username/email и пароль.");
  }
});

document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.password.value !== form.elements.confirmPassword.value) {
    setMessage("Пароли не совпадают.");
    return;
  }
  try {
    await ensureCsrf();
    const data = await api("/api/register", {
      method: "POST",
      body: {
        username: form.elements.username.value.trim(),
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
        confirmPassword: form.elements.confirmPassword.value
      }
    });
    form.reset();
    switchAuthMode("login");
    showLab(data.user);
  } catch (error) {
    if (error.status === 409) {
      setMessage("Username или email уже заняты.");
    } else {
      setMessage("Регистрация не прошла. Проверьте username, email и пароль от 6 символов.");
    }
  }
});

document.querySelector("#recover-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.password.value !== form.elements.confirmPassword.value) {
    setMessage("Пароли не совпадают. Повторите новый пароль ещё раз.");
    return;
  }
  try {
    await ensureCsrf();
    await api("/api/password-reset/complete", {
      method: "POST",
      body: {
        token: form.elements.token.value.trim(),
        password: form.elements.password.value,
        confirmPassword: form.elements.confirmPassword.value
      }
    });
    form.reset();
    switchAuthMode("login");
    setMessage("Пароль изменён. Теперь можно войти.", true);
  } catch {
    setMessage("Reset token неверный, истёк или пароль не подходит.");
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: {} });
  } catch {
    // Logout should still clear the visible session if the server is unreachable.
  }
  csrfToken = null;
  showAuth();
  switchAuthMode("login");
});

function openLogin() {
  showAuth();
  switchAuthMode("login");
}

guestLoginButton.addEventListener("click", openLogin);
document.querySelector("#guest-open-login").addEventListener("click", openLogin);
document.querySelectorAll("[data-guest-login]").forEach((button) => button.addEventListener("click", openLogin));

document.querySelectorAll("[data-guest-section]").forEach((button) => {
  button.addEventListener("click", () => {
    const section = button.dataset.guestSection;
    document.querySelectorAll("[data-guest-section]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-guest-view]").forEach((view) => view.classList.toggle("active", view.dataset.guestView === section));
  });
});

document.querySelectorAll(".section-button").forEach((button) => {
  button.addEventListener("click", () => switchSection(button.dataset.section));
});

function addStoredItem(key, value) {
  const items = readJson(key, []);
  items.unshift({
    value: value.trim(),
    createdAt: new Date().toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
  });
  writeJson(key, items);
}

function renderList(key, targetId, emptyText) {
  const target = document.querySelector(targetId);
  const items = readJson(key, []);
  if (items.length === 0) {
    target.innerHTML = `<div class="item-card"><strong>${emptyText}</strong><span>Добавьте первую запись через форму выше.</span></div>`;
    return;
  }
  target.innerHTML = items.map((item) => (
    `<div class="item-card"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.createdAt)}</span></div>`
  )).join("");
}

function renderAllLists() {
  renderList(userStorageKey(storageKeys.projects), "#project-list", "Проектов пока нет");
  renderList(userStorageKey(storageKeys.notes), "#note-list", "Заметок пока нет");
  renderList(userStorageKey(storageKeys.research), "#research-list", "Исследований пока нет");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function wireListForm(formId, fieldName, key) {
  document.querySelector(formId).addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    addStoredItem(userStorageKey(key), form.elements[fieldName].value);
    form.reset();
    renderAllLists();
  });
}

wireListForm("#project-form", "title", storageKeys.projects);
wireListForm("#note-form", "note", storageKeys.notes);
wireListForm("#research-form", "topic", storageKeys.research);

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = settingsForm.elements.name.value.trim() || currentSession.username;
  const settings = { ...readSettings(), name, compact: settingsForm.elements.compact.checked };
  writeJson(userStorageKey(storageKeys.settings), settings);
  settingsForm.elements.name.value = name;
  document.body.classList.toggle("compact", settings.compact);
  renderCurrentUser(currentSession, settings);
});

function statCard(label, value) {
  return `<div class="item-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

async function loadAdmin() {
  if (!isAdmin(currentSession)) return;
  const [{ stats }, { users }, { events }] = await Promise.all([
    api("/api/admin/stats"),
    api("/api/admin/users"),
    api("/api/admin/audit")
  ]);
  adminSummary.innerHTML = [
    statCard("Всего пользователей", stats.totalUsers),
    statCard("Новые за 24 часа", stats.newUsers),
    statCard("Возвращались", stats.returningUsers),
    statCard("Активны за час", stats.recentlyActive),
    statCard("Отключены/locked", stats.disabledLocked),
    statCard("Успешные входы", stats.successfulLogins),
    statCard("Ошибки входа", stats.failedLogins),
    statCard("Активные сессии", stats.activeSessions)
  ].join("");
  adminUsers.innerHTML = users.map((user) => `
    <div class="item-card">
      <strong>${escapeHtml(user.username)} · ${escapeHtml(user.role)}</strong>
      <span>${escapeHtml(user.email)} · created ${escapeHtml(user.created_at)} · last login ${escapeHtml(user.last_login_at || "never")}</span>
      <div class="admin-actions">
        <button type="button" data-admin-action="${user.disabled ? "enable" : "disable"}" data-user-id="${user.id}">${user.disabled ? "Enable" : "Disable"}</button>
        <button type="button" data-admin-action="sessions" data-user-id="${user.id}">Terminate sessions</button>
        <button type="button" data-admin-action="reset-token" data-user-id="${user.id}">Reset token</button>
        ${currentSession.role === "Owner" ? `<select data-role-user-id="${user.id}">
          ${["User", "Administrator", "Owner"].map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>` : ""}
      </div>
    </div>
  `).join("");
  adminAudit.innerHTML = events.slice(0, 12).map((event) => (
    `<div class="item-card"><strong>${escapeHtml(event.event_type)} · ${event.success ? "OK" : "FAIL"}</strong><span>${escapeHtml(event.created_at)} · user ${escapeHtml(event.user_id || "-")} · ip ${escapeHtml(event.source_ip || "-")}</span></div>`
  )).join("");
}

adminUsers.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-admin-action]");
  if (!button) return;
  const userId = button.dataset.userId;
  const action = button.dataset.adminAction;
  try {
    if (action === "sessions") {
      await api(`/api/admin/users/${userId}/sessions`, { method: "DELETE", body: {} });
    } else if (action === "reset-token") {
      const data = await api(`/api/admin/users/${userId}/reset-token`, { method: "POST", body: {} });
      window.prompt("Одноразовый reset token. Передайте его пользователю безопасным способом:", data.token);
    } else {
      await api(`/api/admin/users/${userId}/${action}`, { method: "POST", body: {} });
    }
    await loadAdmin();
  } catch (error) {
    setMessage(`Admin action failed: ${error.message}`);
  }
});

adminUsers.addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-role-user-id]");
  if (!select) return;
  try {
    await api(`/api/admin/users/${select.dataset.roleUserId}/role`, { method: "POST", body: { role: select.value } });
    await loadAdmin();
  } catch (error) {
    setMessage(`Role update failed: ${error.message}`);
    await loadAdmin();
  }
});

(async function init() {
  try {
    await ensureCsrf();
    const data = await api("/api/session");
    if (data.user) showLab(data.user);
    else showGuest();
  } catch {
    showGuest();
  }
})();
