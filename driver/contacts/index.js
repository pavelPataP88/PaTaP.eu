export function createDriverModule(context) {
  const list = document.querySelector("#contacts-list");
  const labels = {
    incoming: "Входящие запросы",
    outgoing: "Отправленные запросы",
    contacts: "Контакты",
    blocked: "Заблокированные"
  };
  const relationshipLabels = {
    REQUEST_INCOMING: "Входящий запрос",
    REQUEST_SENT: "Запрос отправлен",
    CONTACT: "В контактах",
    BLOCKED: "Заблокирован"
  };

  function createDriverButton(driver) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "contacts-driver";
    const nickname = document.createElement("strong");
    nickname.textContent = driver.nickname;
    const state = document.createElement("span");
    state.textContent = relationshipLabels[driver.relationship] || driver.relationship;
    button.append(nickname, state);
    button.addEventListener("click", () => context.openDriverCard?.(driver.nickname));
    return button;
  }

  async function activate() {
    let data;
    try {
      data = await context.api("/api/driver/contacts");
    } catch (error) {
      if (error.status === 401) context.onAuthLost?.();
      else context.showError?.("Не удалось загрузить контакты.");
      return;
    }
    list.replaceChildren();
    const groups = data.groups || { contacts: data.drivers || [] };
    for (const group of ["incoming", "outgoing", "contacts", "blocked"]) {
      const drivers = groups[group] || [];
      if (!drivers.length) continue;
      const section = document.createElement("section");
      section.className = "contacts-group";
      const title = document.createElement("h3");
      title.textContent = labels[group];
      const items = document.createElement("div");
      items.className = "contacts-items";
      for (const driver of drivers) items.append(createDriverButton(driver));
      section.append(title, items);
      list.append(section);
    }
    if (!(data.drivers || []).length) {
      const empty = document.createElement("p");
      empty.className = "contacts-empty";
      empty.textContent = "Пока нет контактов или запросов. Найдите водителя на карте, чтобы начать связь.";
      list.append(empty);
    }
  }

  return { activate };
}
