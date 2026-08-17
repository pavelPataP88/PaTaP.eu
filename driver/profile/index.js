import { populateCountrySelect } from "../shared/countries.js?v=20260714-10";

export function createProfileController({ api, showError, onSaved, onAuthLost }) {
  const form = document.querySelector("#profile-form");
  const state = document.querySelector("#profile-state");
  populateCountrySelect(form.elements.countryCode);

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
