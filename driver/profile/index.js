import { populateCountrySelect } from "../shared/countries.js?v=20260714-10";

function downloadJson(value, generatedAt) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = String(generatedAt || new Date().toISOString()).slice(0, 10);
  anchor.href = url;
  anchor.download = `patap-account-export-${stamp}.json`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function accountDeleteMessage(error) {
  if (error.message === "invalid_credentials") return "Неверный пароль.";
  if (error.message === "account_delete_confirmation_required") return "Введите DELETE без пробелов.";
  if (error.message === "principal_owner_protected") return "Главный Owner защищён. Этот аккаунт нельзя удалить обычным способом.";
  if (error.message === "account_ownership_transfer_required") return "Сначала передайте владельца своих групп, сообществ и радиоканалов.";
  if (error.message === "account_media_cleanup_failed") return "Не удалось безопасно подготовить медиа к удалению. Ничего не удалено.";
  if (error.message === "account_delete_rate_limited") return "Слишком много попыток удаления. Повторите позже.";
  return "Не удалось удалить аккаунт. Данные оставлены без изменений.";
}

function installAccountControls({ form, api, showError, onAuthLost }) {
  if (form.querySelector("[data-account-controls]")) return;
  form.style.overflowY = "auto";

  const section = document.createElement("section");
  section.dataset.accountControls = "true";
  section.innerHTML = `
    <h2>Мои данные и аккаунт</h2>
    <p class="help">Можно скачать данные аккаунта в JSON. Пароли, токены, ключи Push и внутренние ключи хранения в экспорт не входят.</p>
    <div class="actions">
      <button class="quiet" type="button" data-account-export>Скачать мои данные</button>
      <span data-account-export-state role="status" aria-live="polite"></span>
    </div>
    <details>
      <summary class="text-button">Удалить аккаунт</summary>
      <p class="help">Удаление необратимо. GPS, сессии, контакты, настройки и личные медиа удаляются. Общая история остаётся только в обезличенном виде. Если вы владелец группы или сообщества, сначала передайте владельца.</p>
      <label>Текущий пароль
        <input type="password" autocomplete="current-password" data-account-delete-password>
      </label>
      <label>Для подтверждения введите DELETE
        <input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-account-delete-confirmation>
      </label>
      <div class="actions">
        <button class="quiet" type="button" data-account-delete>Удалить аккаунт навсегда</button>
        <span data-account-delete-state role="status" aria-live="polite"></span>
      </div>
    </details>
  `;
  form.append(section);

  const exportButton = section.querySelector("[data-account-export]");
  const exportState = section.querySelector("[data-account-export-state]");
  const deleteButton = section.querySelector("[data-account-delete]");
  const deleteState = section.querySelector("[data-account-delete-state]");
  const password = section.querySelector("[data-account-delete-password]");
  const confirmation = section.querySelector("[data-account-delete-confirmation]");

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    exportState.textContent = "Готовим…";
    try {
      const data = await api("/api/driver/account/export");
      downloadJson(data.export, data.export?.generatedAt);
      exportState.textContent = "Файл подготовлен";
    } catch (error) {
      exportState.textContent = "";
      if (error.status === 401) onAuthLost();
      else showError(error.message === "account_export_rate_limited" ? "Слишком много экспортов. Повторите позже." : "Не удалось подготовить экспорт данных.");
    } finally {
      exportButton.disabled = false;
    }
  });

  for (const input of [password, confirmation]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });
  }

  deleteButton.addEventListener("click", async () => {
    if (!password.value) return showError("Введите текущий пароль.");
    if (confirmation.value.trim() !== "DELETE") return showError("Для удаления введите DELETE без пробелов.");
    if (!globalThis.confirm("Удалить аккаунт PaTaP навсегда? Это действие нельзя отменить.")) return;

    deleteButton.disabled = true;
    exportButton.disabled = true;
    deleteState.textContent = "Удаляем…";
    try {
      await api("/api/driver/account", {
        method: "DELETE",
        body: { password: password.value, confirmation: confirmation.value.trim() }
      });
      password.value = "";
      confirmation.value = "";
      deleteState.textContent = "Аккаунт удалён";
      if (globalThis.location?.reload) globalThis.location.reload();
      else onAuthLost();
    } catch (error) {
      deleteState.textContent = "";
      if (error.status === 401) onAuthLost();
      else showError(accountDeleteMessage(error));
      exportButton.disabled = false;
      deleteButton.disabled = false;
    }
  });
}

export function createProfileController({ api, showError, onSaved, onAuthLost }) {
  const form = document.querySelector("#profile-form");
  const state = document.querySelector("#profile-state");
  populateCountrySelect(form.elements.countryCode);
  installAccountControls({ form, api, showError, onAuthLost });

  function set(profile) {
    const values = profile || {};
    for (const name of ["nickname", "driverType", "realName", "vehicle", "countryCode"]) {
      form.elements[name].value = values[name] || "";
    }
    state.textContent = profile ? "Профиль загружен" : "Заполните обязательные поля";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    state.textContent = "Сохраняем…";
    try {
      const data = await api("/api/driver/profile", {
        method: "PUT",
        body: Object.fromEntries(new FormData(form))
      });
      set(data.profile);
      state.textContent = "Сохранено";
      onSaved(data.profile);
    } catch (error) {
      state.textContent = "";
      if (error.status === 401) onAuthLost();
      else showError(error.message === "nickname_exists" ? "Этот никнейм уже занят." : "Проверьте поля профиля.");
    } finally {
      submit.disabled = false;
    }
  });

  return { set };
}

export function createDriverModule(context) {
  const controller = createProfileController({
    api: context.api,
    showError: context.showError,
    onSaved: context.onProfileSaved,
    onAuthLost: context.onAuthLost
  });
  return {
    controller,
    setSession({ profile }) { controller.set(profile); }
  };
}
