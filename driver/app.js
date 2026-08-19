import { api, ensureCsrf, resetCsrf, uploadBinary } from "./shared/api.js?v=20260721-1";
import { createNavigationController } from "./core/navigation.js?v=20260714-8";
import {
  createDriverModuleRuntime,
  loadDriverModuleRegistry,
  validateDriverModuleRegistry
} from "./core/module-loader.mjs?v=20260714-8";

const views = {
  loading: document.querySelector("#loading"),
  login: document.querySelector("#login-view"),
  profile: document.querySelector("#profile-view"),
  guest: document.querySelector("#guest-view")
};
const message = document.querySelector("#message");
const logoutButton = document.querySelector("#logout");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#driver-register-form");
let runtime = null;
let profileRequiredViews = [];
let messageTimer = null;
let authResetPromise = null;

function setProfileNavigation(enabled) {
  for (const view of profileRequiredViews) navigation.setEnabled(view, enabled);
}

function show(view) {
  Object.entries(views).forEach(([name, element]) => { element.hidden = name !== view; });
  logoutButton.hidden = view !== "profile";
}

function showGuest() {
  show("guest");
}

function openLogin() {
  showAuthForm("login");
  show("login");
}

function showError(text) {
  if (messageTimer !== null) window.clearTimeout(messageTimer);
  message.textContent = text;
  message.hidden = false;
  messageTimer = window.setTimeout(() => {
    message.hidden = true;
    messageTimer = null;
  }, 6000);
}

function showAuthForm(mode) {
  loginForm.hidden = mode !== "login";
  registerForm.hidden = mode !== "register";
}

function handleAuthLost() {
  openLogin();
  showError("Сессия истекла. Войдите снова.");
  if (authResetPromise) return;
  authResetPromise = Promise.resolve(runtime?.invoke("reset"))
    .catch(() => {})
    .finally(() => {
      resetCsrf();
      authResetPromise = null;
    });
}

const navigation = createNavigationController({
  onChange(name) {
    runtime?.activate(name).catch(() => showError("Раздел временно недоступен."));
  }
});

async function setupRuntime() {
  const registry = await loadDriverModuleRegistry("/module-registry.json?v=20260819-people-v1");
  const modules = validateDriverModuleRegistry(registry).filter((module) => module.enabled);
  profileRequiredViews = modules.filter((module) => module.requiresProfile && module.view).map((module) => module.view);
  navigation.configure(modules);
  runtime = await createDriverModuleRuntime({
    registry,
    context: {
      api,
      uploadBinary,
      showError,
      onAuthLost: handleAuthLost,
      openDriverCard: (nickname) => {
        navigation.show("map");
        runtime?.get("driver-card")?.open(nickname).catch(() => showError("Не удалось открыть карточку водителя."));
      },
      openDirectChat: async (nickname) => {
        const chat = runtime?.get("chat");
        if (!chat) return showError("Чат временно недоступен.");
        await chat.openDirect(nickname);
        navigation.show("chat");
      },
      openChatRoom: async (roomId) => {
        const chat = runtime?.get("chat");
        if (!chat?.openRoom) return showError("Чат сообщества временно недоступен.");
        await chat.openRoom(roomId);
        navigation.show("chat");
      },
      openDirectRadio: async (nickname) => {
        const radio = runtime?.get("radio");
        if (!radio) return showError("Рация временно недоступна.");
        await radio.openDirect(nickname);
        navigation.show("radio");
      },
      openRadioChannel: async (channelId) => {
        const radio = runtime?.get("radio");
        if (!radio) return showError("Рация временно недоступна.");
        await radio.activate();
        const search = document.querySelector(".radio-console-search input");
        if (search?.value) {
          search.value = "";
          search.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const channelTab = document.querySelectorAll(".radio-console-tabs button")[1];
        channelTab?.click();
        const row = document.querySelector(`.radio-channel-item[data-channel-id="${Number(channelId)}"]`);
        if (!row) return showError("Радиоканал сообщества больше недоступен.");
        row.click();
        navigation.show("radio");
      },
      onProfileSaved: async (profile) => {
        await runtime?.invoke("setProfileReady", profile);
        setProfileNavigation(true);
        if (!navigation.show("map")) navigation.show("profile");
      }
    },
    onModuleError(module) {
      navigation.removeModule(module);
      showError(`Раздел «${module.label || module.id}» временно недоступен.`);
    }
  });
  if (!runtime.get("profile")) throw new Error("profile_module_unavailable");
}

async function openProfile(user) {
  document.querySelector("#account-line").textContent = `Аккаунт: ${user.username}`;
  const { profile } = await api("/api/driver/profile");
  await runtime.invoke("setSession", { user, profile });
  setProfileNavigation(Boolean(profile));
  show("profile");
  if (!profile || !navigation.show("map")) navigation.show("profile");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    if (authResetPromise) await authResetPromise;
    await ensureCsrf();
    const data = await api("/api/login", { method: "POST", body: Object.fromEntries(new FormData(loginForm)) });
    await openProfile(data.user);
    loginForm.reset();
  } catch (error) {
    showError(error.message === "invalid_credentials" ? "Неверный логин или пароль." : "Не удалось войти. Попробуйте ещё раз.");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#show-driver-register").addEventListener("click", () => showAuthForm("register"));
document.querySelector("#show-driver-login").addEventListener("click", () => showAuthForm("login"));
document.querySelectorAll("#guest-map-login, #guest-chat-login, #guest-contacts-login, #guest-profile-login").forEach((button) => button.addEventListener("click", openLogin));
document.querySelectorAll("[data-guest-driver-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    const view = button.dataset.guestDriverView;
    document.querySelectorAll("[data-guest-driver-view]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-guest-driver-panel]").forEach((panel) => { panel.hidden = panel.dataset.guestDriverPanel !== view; });
    if (view === "map") {
      try {
        const { openGuestRoadReportMap } = await import("./map/guest-road-reports.mjs?v=20260818-fix01");
        await openGuestRoadReportMap({ api, showError });
      } catch {}
    }
  });
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = registerForm.querySelector("button[type=submit]");
  if (registerForm.elements.password.value !== registerForm.elements.confirmPassword.value) {
    return showError("Пароли не совпадают.");
  }
  submit.disabled = true;
  try {
    if (authResetPromise) await authResetPromise;
    await ensureCsrf();
    const data = await api("/api/driver/register", { method: "POST", body: Object.fromEntries(new FormData(registerForm)) });
    await openProfile(data.user);
    registerForm.reset();
  } catch (error) {
    showError(error.status === 409 ? "Логин, email или никнейм уже заняты." : "Проверьте поля регистрации, никнейм и тип водителя.");
  } finally {
    submit.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await runtime?.invoke("reset");
    await api("/api/logout", { method: "POST", body: {} });
  } finally {
    resetCsrf();
    await ensureCsrf().catch(() => {});
    show("login");
  }
});

(async () => {
  try {
    await setupRuntime();
    const session = await api("/api/session");
    if (session.user) await openProfile(session.user);
    else showGuest();
  } catch {
    showError("Driver Patap временно не может связаться с сервером. Открыт безопасный демо-режим.");
    showGuest();
  }
})();