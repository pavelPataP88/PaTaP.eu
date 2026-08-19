import { countryLabel } from "../shared/countries.js?v=20260714-10";

export function createDriverModule(context) {
  const card = document.querySelector("#driver-card");
  const status = document.querySelector("#driver-card-status");
  const name = document.querySelector("#driver-card-name");
  const details = document.querySelector("#driver-card-details");
  const searchForm = document.querySelector("#driver-search-form");
  const results = document.querySelector("#driver-search-results");
  let driver = null;
  const relationshipLabel = { STRANGER: "Незнакомый", REQUEST_SENT: "Запрос отправлен", REQUEST_INCOMING: "Входящий запрос", CONTACT: "Контакт", BLOCKED: "Заблокирован" };
  const gpsLabel = { ACTIVE: "В сети", STALE: "Позиция устарела", OFF: "GPS выключен", HIDDEN: "Позиция скрыта" };

  function reportError(error, message) {
    if (error?.status === 401) {
      driver = null;
      context.onAuthLost?.();
      return;
    }
    if (error?.message === "contact_requests_disabled") return context.showError?.("Этот водитель не принимает новые запросы в контакты.");
    context.showError?.(message);
  }

  function render(value) {
    driver = value;
    if (!driver) return card.hidden = true;
    status.textContent = `${gpsLabel[driver.gps] || driver.gps} · ${relationshipLabel[driver.relationship] || driver.relationship}`;
    name.textContent = driver.nickname;
    details.replaceChildren();
    for (const [label, value] of [["Тип", driver.driverType], ["Транспорт", driver.vehicle], ["Страна", countryLabel(driver.countryCode)], ["GPS", gpsLabel[driver.gps] || driver.gps], ["Обновлено", driver.locationUpdatedAt ? new Date(driver.locationUpdatedAt).toLocaleString() : driver.gps === "HIDDEN" ? "скрыто настройками" : "нет позиции"]]) {
      if (!value) continue;
      const term = document.createElement("dt"); term.textContent = label;
      const description = document.createElement("dd"); description.textContent = value;
      details.append(term, description);
    }
    const contactButton = document.querySelector("#driver-card-contact");
    const requestsClosed = driver.relationship === "STRANGER" && driver.canRequestContact === false;
    contactButton.textContent = driver.relationship === "CONTACT" ? "В контактах" : driver.relationship === "REQUEST_SENT" ? "Запрос отправлен" : driver.relationship === "REQUEST_INCOMING" ? "Принять запрос" : requestsClosed ? "Запросы закрыты" : "В контакты";
    contactButton.disabled = ["CONTACT", "REQUEST_SENT", "BLOCKED"].includes(driver.relationship) || requestsClosed;
    const radioButton = document.querySelector("#driver-card-radio");
    radioButton.disabled = driver.relationship !== "CONTACT";
    radioButton.title = driver.relationship === "CONTACT" ? "Открыть прямую рацию" : "Рация доступна после подтверждения контакта";
    const chatButton = document.querySelector("#driver-card-chat");
    chatButton.disabled = driver.relationship === "BLOCKED";
    const blockButton = document.querySelector("#driver-card-block");
    blockButton.textContent = driver.relationship === "BLOCKED" ? "Разблокировать" : "Блокировать";
    blockButton.disabled = false;
    card.hidden = false;
  }

  async function open(nickname) {
    try {
      const data = await context.api(`/api/driver/drivers/${encodeURIComponent(nickname)}`);
      render(data.driver);
    } catch (error) {
      reportError(error, "Не удалось открыть карточку водителя.");
    }
  }

  async function runAction(button, message, action) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      reportError(error, message);
    } finally {
      if (driver) render(driver);
    }
  }

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = searchForm.elements.query.value.trim();
    if (query.length < 2) return;
    try {
      const data = await context.api(`/api/driver/drivers?query=${encodeURIComponent(query)}`);
      results.replaceChildren();
      for (const item of data.drivers) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.nickname;
        button.addEventListener("click", () => open(item.nickname));
        results.append(button);
      }
    } catch (error) {
      reportError(error, "Не удалось выполнить поиск водителя.");
    }
  });
  document.querySelector("#driver-card-close").addEventListener("click", () => render(null));
  document.querySelector("#driver-card-contact").addEventListener("click", (event) => {
    if (!driver || ["CONTACT", "BLOCKED"].includes(driver.relationship) || (driver.relationship === "STRANGER" && driver.canRequestContact === false)) return;
    runAction(event.currentTarget, "Не удалось изменить состояние контакта.", async () => {
      const data = await context.api(`/api/driver/drivers/${encodeURIComponent(driver.nickname)}/contact`, { method: "POST", body: {} });
      render(data.driver);
    });
  });
  document.querySelector("#driver-card-block").addEventListener("click", (event) => {
    if (!driver) return;
    runAction(event.currentTarget, "Не удалось изменить блокировку.", async () => {
      const data = await context.api(`/api/driver/drivers/${encodeURIComponent(driver.nickname)}/block`, { method: "PUT", body: { enabled: driver.relationship !== "BLOCKED" } });
      render(data.driver);
    });
  });
  document.querySelector("#driver-card-chat").addEventListener("click", (event) => {
    if (!driver) return;
    runAction(event.currentTarget, "Не удалось открыть личный чат.", () => context.openDirectChat?.(driver.nickname));
  });
  document.querySelector("#driver-card-radio").addEventListener("click", (event) => {
    if (!driver || driver.relationship !== "CONTACT") return;
    runAction(event.currentTarget, "Не удалось открыть прямую рацию.", () => context.openDirectRadio?.(driver.nickname));
  });
  return {
    open,
    reset() {
      driver = null;
      searchForm.reset();
      results.replaceChildren();
      card.hidden = true;
    }
  };
}
