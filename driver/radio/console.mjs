const STYLE_ID = "patap-radio-console-v2";

const KIND_LABEL = Object.freeze({ GENERAL: "Общий", GROUP: "Канал", DIRECT: "Прямой" });
const ROLE_LABEL = Object.freeze({ OWNER: "Владелец", MODERATOR: "Модератор", TRUSTED: "Доверенный", MEMBER: "Участник", LISTENER: "Только слушает" });
const POLICY_LABEL = Object.freeze({ EVERYONE: "Говорят все", TRUSTED: "Говорят доверенные", BROADCAST: "Вещание" });

function button(text, className = "") {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

export function installRadioConsoleStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.radio-card.radio-console-card{padding:14px;overflow:hidden}.radio-console-card .radio-heading{flex:0 0 auto}.radio-console-topbar{display:flex;align-items:center;gap:8px;margin-top:10px;overflow-x:auto;padding-bottom:2px}.radio-console-topbar button,.radio-console-topbar select,.radio-talk-tools button{flex:0 0 auto;min-height:38px;border:1px solid var(--line);border-radius:12px;padding:7px 11px;background:#0a1914;color:var(--muted);font-weight:800}.radio-console-topbar button.active,.radio-talk-tools button.active{border-color:var(--accent);color:var(--accent)}.radio-console-shell{display:grid;grid-template-columns:minmax(210px,280px) minmax(0,1fr);gap:12px;flex:1 1 auto;min-height:0;margin-top:10px}.radio-console-sidebar,.radio-console-talk{min-height:0;border:1px solid var(--line);border-radius:18px;background:#08130f}.radio-console-sidebar{display:flex;flex-direction:column;padding:10px}.radio-console-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.radio-console-tabs button{min-height:38px;border:0;border-radius:10px;background:#0d2019;color:var(--muted);font-size:.8rem;font-weight:850}.radio-console-tabs button.active{background:var(--accent);color:var(--accent-dark)}.radio-console-search{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px}.radio-console-search input{min-height:40px}.radio-console-search button{min-height:40px;border:1px solid var(--line);border-radius:11px;background:#10251d;color:var(--accent);font-weight:900}.radio-channels{display:grid;gap:7px;overflow:auto;margin-top:9px;padding-right:2px}.radio-channels .radio-channel-item{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:9px;align-items:center;width:100%;min-height:58px;padding:8px;border:1px solid transparent;border-radius:13px;background:#0a1914;color:inherit;text-align:left;cursor:pointer}.radio-channel-item:hover{border-color:var(--line)}.radio-channel-item.active{border-color:var(--accent);background:#10251d}.radio-channel-avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#17382d;color:var(--accent);font-weight:950}.radio-channel-copy{min-width:0}.radio-channel-copy strong,.radio-channel-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.radio-channel-copy small{margin-top:3px;color:var(--muted);font-size:.72rem}.radio-channel-meta{display:grid;justify-items:end;gap:3px;color:var(--muted);font-size:.7rem}.radio-channel-unread{display:grid;min-width:22px;height:22px;place-items:center;border-radius:999px;background:#ff8f87;color:#25100f;font-weight:950}.radio-channel-live{color:#ffaaa2;font-weight:850}.radio-console-talk{display:flex;flex-direction:column;padding:12px}.radio-talk-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.radio-talk-title{min-width:0}.radio-talk-title strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1.08rem}.radio-talk-title span{display:block;margin-top:3px;color:var(--muted);font-size:.78rem}.radio-talk-tools{display:flex;gap:6px;overflow-x:auto}.radio-pins{display:flex;gap:7px;margin-top:8px;overflow-x:auto}.radio-pin{flex:0 0 auto;max-width:260px;border:1px solid rgba(104,224,173,.3);border-radius:12px;padding:8px 10px;background:#0d261d;color:#dff8ed;text-align:left}.radio-pin small{display:block;color:var(--muted);margin-top:2px}.radio-transmissions{flex:1 1 auto;min-height:110px;margin-top:9px}.radio-ptt-wrap{flex:0 0 auto}.radio-console-alert{margin:8px 0 0;padding:9px 11px;border:1px solid #ffcf7a;border-radius:12px;background:rgba(255,207,122,.09);color:#ffe2a7;font-size:.82rem}.radio-console-alert[hidden]{display:none}.radio-console-dialog{width:min(620px,calc(100vw - 28px));max-height:min(82vh,720px);border:1px solid var(--line);border-radius:20px;padding:0;background:#0b1814;color:#f4f8f6;box-shadow:0 25px 90px rgba(0,0,0,.55)}.radio-console-dialog::backdrop{background:rgba(0,0,0,.62);backdrop-filter:blur(4px)}.radio-dialog-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:#0b1814}.radio-dialog-head h3{margin:0;font-size:1.05rem}.radio-dialog-close{width:38px;height:38px;border:1px solid var(--line);border-radius:12px;background:#10251d;color:inherit}.radio-dialog-body{display:grid;gap:10px;padding:14px 16px;overflow:auto}.radio-dialog-body label{display:grid;gap:6px}.radio-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}.radio-dialog-actions button,.radio-dialog-body .radio-row-action{min-height:40px;border:1px solid var(--line);border-radius:11px;padding:7px 12px;background:#10251d;color:inherit;font-weight:800}.radio-dialog-actions .primary{background:var(--accent);color:var(--accent-dark)}.radio-list-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:13px;background:#091711}.radio-list-row strong,.radio-list-row small{display:block}.radio-list-row small{margin-top:3px;color:var(--muted)}.radio-list-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.radio-list-actions select{min-height:38px}.radio-car-controls{display:none}.radio-console-card.radio-car-mode .radio-console-topbar,.radio-console-card.radio-car-mode .radio-console-sidebar,.radio-console-card.radio-car-mode .radio-transmissions,.radio-console-card.radio-car-mode .radio-pins,.radio-console-card.radio-car-mode .radio-talk-tools{display:none}.radio-console-card.radio-car-mode .radio-console-shell{grid-template-columns:1fr}.radio-console-card.radio-car-mode .radio-console-talk{border:0;background:transparent;padding:4px}.radio-console-card.radio-car-mode .radio-live-status{margin-top:8px}.radio-console-card.radio-car-mode .radio-ptt{min-height:min(48vh,420px);font-size:clamp(1.35rem,5vw,2.3rem);border-radius:36px}.radio-console-card.radio-car-mode .radio-car-controls{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.radio-car-controls button{min-height:56px;border:1px solid var(--line);border-radius:14px;background:#10251d;color:inherit;font-weight:900}.radio-console-card.radio-car-mode .radio-ptt-hint{text-align:center;font-size:.9rem}@media(max-width:820px){.radio-console-shell{grid-template-columns:1fr}.radio-console-sidebar{max-height:235px}.radio-console-talk{min-height:0}.radio-channels{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.radio-talk-head{display:grid}.radio-talk-tools{width:100%}}@media(max-width:520px){.radio-card.radio-console-card{padding:10px}.radio-console-sidebar,.radio-console-talk{border-radius:15px;padding:9px}.radio-console-tabs button{font-size:.74rem}.radio-channels{grid-template-columns:1fr}.radio-console-card.radio-car-mode .radio-car-controls{grid-template-columns:repeat(2,1fr)}}
`;
  document.head.append(style);
}

export function createRadioConsoleUi({ card, title, state, channelsElement, help, transmissionsElement, ptt }) {
  installRadioConsoleStyles();
  card.classList.add("radio-console-card");
  const heading = card.querySelector(".radio-heading");
  const note = card.querySelector(".radio-note");

  const topbar = document.createElement("div");
  topbar.className = "radio-console-topbar";
  const statusSelect = document.createElement("select");
  statusSelect.setAttribute("aria-label", "Статус рации");
  statusSelect.append(option("AVAILABLE", "В эфире"), option("BUSY", "Не беспокоить"), option("SOLO", "Solo"));
  const createButton = button("+ Канал");
  const discoverButton = button("Найти канал");
  const invitesButton = button("Приглашения");
  const echoButton = button("Тест микрофона");
  const carButton = button("Режим вождения");
  const liveButton = button("Живой звук: выкл");
  const speedSelect = document.createElement("select");
  speedSelect.setAttribute("aria-label", "Скорость воспроизведения");
  speedSelect.append(option("1", "1×"), option("1.25", "1.25×"), option("1.5", "1.5×"));
  topbar.append(statusSelect, createButton, discoverButton, invitesButton, echoButton, carButton, liveButton, speedSelect);

  const shell = document.createElement("div");
  shell.className = "radio-console-shell";
  const sidebar = document.createElement("aside");
  sidebar.className = "radio-console-sidebar";
  const tabs = document.createElement("div");
  tabs.className = "radio-console-tabs";
  const tabRecent = button("Недавние");
  const tabChannels = button("Каналы");
  const tabDirect = button("Прямые");
  tabs.append(tabRecent, tabChannels, tabDirect);
  const search = document.createElement("div");
  search.className = "radio-console-search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Фильтр каналов";
  searchInput.setAttribute("aria-label", "Фильтр каналов рации");
  const clearSearch = button("×");
  clearSearch.setAttribute("aria-label", "Очистить фильтр");
  search.append(searchInput, clearSearch);
  sidebar.append(tabs, search, channelsElement, help);

  const talk = document.createElement("section");
  talk.className = "radio-console-talk";
  const talkHead = document.createElement("div");
  talkHead.className = "radio-talk-head";
  const talkTitle = document.createElement("div");
  talkTitle.className = "radio-talk-title";
  const talkName = document.createElement("strong");
  talkName.textContent = "Канал не выбран";
  const talkMeta = document.createElement("span");
  talkMeta.textContent = "Выберите канал слева";
  talkTitle.append(talkName, talkMeta);
  const tools = document.createElement("div");
  tools.className = "radio-talk-tools";
  const favoriteButton = button("☆"); favoriteButton.setAttribute("aria-label", "Добавить канал в избранное");
  const muteButton = button("Звук");
  const defaultButton = button("По умолчанию");
  const replayButton = button("Повтор");
  const membersButton = button("Участники");
  const alertButton = button("Вызов");
  const settingsButton = button("Настройки");
  tools.append(favoriteButton, muteButton, defaultButton, replayButton, membersButton, alertButton, settingsButton);
  talkHead.append(talkTitle, tools);

  const alertBanner = document.createElement("div");
  alertBanner.className = "radio-console-alert";
  alertBanner.hidden = true;
  alertBanner.setAttribute("role", "status");
  const pins = document.createElement("div");
  pins.className = "radio-pins";
  pins.hidden = true;
  const liveMount = document.createElement("div");
  const pttWrap = document.createElement("div");
  pttWrap.className = "radio-ptt-wrap";
  pttWrap.append(ptt);
  if (note) pttWrap.append(note);
  talk.append(talkHead, alertBanner, pins, liveMount, transmissionsElement, pttWrap);

  const carControls = document.createElement("div");
  carControls.className = "radio-car-controls";
  const prevButton = button("← Канал");
  const carReplayButton = button("Повтор");
  const nextButton = button("Канал →");
  const exitCarButton = button("Выйти");
  carControls.append(prevButton, carReplayButton, nextButton, exitCarButton);
  talk.append(carControls);

  shell.append(sidebar, talk);
  card.replaceChildren(heading, topbar, shell);

  const dialog = document.createElement("dialog");
  dialog.className = "radio-console-dialog";
  const dialogHead = document.createElement("div"); dialogHead.className = "radio-dialog-head";
  const dialogTitle = document.createElement("h3");
  const dialogClose = button("×", "radio-dialog-close"); dialogClose.setAttribute("aria-label", "Закрыть");
  dialogHead.append(dialogTitle, dialogClose);
  const dialogBody = document.createElement("div"); dialogBody.className = "radio-dialog-body";
  dialog.append(dialogHead, dialogBody);
  document.body.append(dialog);
  dialogClose.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  let filter = "RECENT";
  let currentItems = [];
  let currentActiveId = null;
  let selectHandler = null;

  function matchesFilter(item) {
    if (filter === "CHANNELS") return item.kind === "GENERAL" || item.kind === "GROUP";
    if (filter === "DIRECT") return item.kind === "DIRECT";
    return true;
  }

  function renderChannelItems() {
    channelsElement.replaceChildren();
    const query = searchInput.value.trim().toLocaleLowerCase();
    const items = currentItems.filter(matchesFilter).filter((item) => !query || item.title.toLocaleLowerCase().includes(query));
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "radio-empty";
      empty.textContent = query ? "Ничего не найдено." : "Здесь пока нет каналов.";
      channelsElement.append(empty);
      return;
    }
    for (const item of items) {
      const row = button("");
      row.className = "radio-channel-item";
      row.classList.toggle("active", Number(item.id) === Number(currentActiveId));
      row.dataset.channelId = String(item.id);
      row.setAttribute("aria-label", `${KIND_LABEL[item.kind] || "Канал"}: ${item.title}${item.unreadCount ? `, непрослушанных ${item.unreadCount}` : ""}`);
      const avatar = document.createElement("span"); avatar.className = "radio-channel-avatar";
      avatar.textContent = item.kind === "DIRECT" ? "1:1" : item.kind === "GENERAL" ? "ALL" : item.title.slice(0, 2).toUpperCase();
      const copy = document.createElement("span"); copy.className = "radio-channel-copy";
      const name = document.createElement("strong"); name.textContent = `${item.favorite ? "★ " : ""}${item.title}`;
      const meta = document.createElement("small");
      const detail = item.kind === "DIRECT" ? "Прямой эфир" : `${item.memberCount || 0} участн. · ${POLICY_LABEL[item.talkPolicy] || "Канал"}`;
      meta.textContent = `${detail}${item.muted ? " · без звука" : ""}`;
      copy.append(name, meta);
      const right = document.createElement("span"); right.className = "radio-channel-meta";
      if (item.speaker && !item.speaker.isSelf) { const live = document.createElement("span"); live.className = "radio-channel-live"; live.textContent = "● эфир"; right.append(live); }
      if (item.unreadCount) { const unread = document.createElement("span"); unread.className = "radio-channel-unread"; unread.textContent = item.unreadCount > 99 ? "99+" : String(item.unreadCount); right.append(unread); }
      row.append(avatar, copy, right);
      row.addEventListener("click", () => selectHandler?.(item));
      channelsElement.append(row);
    }
  }

  function setFilter(next) {
    filter = next;
    tabRecent.classList.toggle("active", next === "RECENT");
    tabChannels.classList.toggle("active", next === "CHANNELS");
    tabDirect.classList.toggle("active", next === "DIRECT");
    renderChannelItems();
  }
  tabRecent.addEventListener("click", () => setFilter("RECENT"));
  tabChannels.addEventListener("click", () => setFilter("CHANNELS"));
  tabDirect.addEventListener("click", () => setFilter("DIRECT"));
  searchInput.addEventListener("input", renderChannelItems);
  clearSearch.addEventListener("click", () => { searchInput.value = ""; renderChannelItems(); searchInput.focus(); });
  setFilter("RECENT");

  return {
    liveMount,
    controls: {
      statusSelect, createButton, discoverButton, invitesButton, echoButton, carButton, liveButton, speedSelect,
      favoriteButton, muteButton, defaultButton, replayButton, membersButton, alertButton, settingsButton,
      prevButton, carReplayButton, nextButton, exitCarButton
    },
    renderChannels(items, { activeId = null, onSelect } = {}) {
      currentItems = Array.isArray(items) ? items.slice() : [];
      currentActiveId = activeId;
      if (onSelect) selectHandler = onSelect;
      renderChannelItems();
    },
    setChannel(item) {
      currentActiveId = item?.id ?? null;
      talkName.textContent = item?.title || "Канал не выбран";
      const kind = KIND_LABEL[item?.kind] || "Рация";
      const role = item?.role ? ROLE_LABEL[item.role] || item.role : "";
      talkMeta.textContent = item ? `${kind}${role ? ` · ${role}` : ""}${item.kind !== "DIRECT" ? ` · ${POLICY_LABEL[item.talkPolicy] || ""}` : ""}` : "Выберите канал слева";
      favoriteButton.textContent = item?.favorite ? "★" : "☆";
      favoriteButton.classList.toggle("active", Boolean(item?.favorite));
      muteButton.textContent = item?.muted ? "Без звука" : "Звук";
      muteButton.classList.toggle("active", !item?.muted);
      defaultButton.classList.toggle("active", Boolean(item?.isDefault));
      membersButton.hidden = !item || item.kind === "DIRECT";
      alertButton.hidden = !item || item.kind === "GENERAL" || (item.kind === "GROUP" && !item.canModerate);
      settingsButton.hidden = !item || !item.canManage;
      renderChannelItems();
    },
    renderPins(items, onPlay) {
      pins.replaceChildren();
      const list = Array.isArray(items) ? items : [];
      pins.hidden = list.length === 0;
      for (const item of list) {
        const pin = button(""); pin.className = "radio-pin";
        const name = document.createElement("strong"); name.textContent = `Закреплено · ${item.sender.nickname}`;
        const time = document.createElement("small"); time.textContent = new Date(item.committedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
        pin.append(name, time); pin.addEventListener("click", () => onPlay?.(item)); pins.append(pin);
      }
    },
    showAlert(alert) {
      if (!alert) { alertBanner.hidden = true; alertBanner.textContent = ""; return; }
      alertBanner.hidden = false;
      alertBanner.textContent = `Вызов: ${alert.sender?.nickname || "Driver"} · ${alert.channelTitle || "канал"}`;
    },
    setSettings(settings) {
      statusSelect.value = settings?.status || "AVAILABLE";
      liveButton.textContent = settings?.autoPlay ? "Живой звук: вкл" : "Живой звук: выкл";
      liveButton.classList.toggle("active", Boolean(settings?.autoPlay));
      speedSelect.value = String(settings?.playbackRate || 1);
    },
    setInvitesCount(count) {
      invitesButton.textContent = count ? `Приглашения · ${count}` : "Приглашения";
      invitesButton.classList.toggle("active", Number(count) > 0);
    },
    setCarMode(enabled) {
      card.classList.toggle("radio-car-mode", Boolean(enabled));
      carButton.textContent = enabled ? "Обычный режим" : "Режим вождения";
    },
    showDialog(titleText, content) {
      dialogTitle.textContent = titleText;
      dialogBody.replaceChildren();
      if (content instanceof Node) dialogBody.append(content);
      else if (Array.isArray(content)) dialogBody.append(...content);
      dialog.showModal();
      return dialog;
    },
    closeDialog() { dialog.close(); },
    makeRow({ title: rowTitle, subtitle = "", actions = [] }) {
      const row = document.createElement("div"); row.className = "radio-list-row";
      const copy = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = rowTitle;
      copy.append(strong); if (subtitle) { const small = document.createElement("small"); small.textContent = subtitle; copy.append(small); }
      const actionBox = document.createElement("div"); actionBox.className = "radio-list-actions"; actionBox.append(...actions);
      row.append(copy, actionBox); return row;
    },
    makeAction(text, handler, className = "radio-row-action") { const node = button(text, className); node.addEventListener("click", handler); return node; },
    makeSelect(values, current, handler) {
      const select = document.createElement("select");
      for (const [value, label] of values) select.append(option(value, label));
      select.value = current;
      select.addEventListener("change", () => handler(select.value));
      return select;
    },
    makeForm(fields, submitText, onSubmit) {
      const form = document.createElement("form");
      for (const field of fields) {
        const label = document.createElement("label"); label.textContent = field.label;
        let input;
        if (field.type === "select") {
          input = document.createElement("select");
          for (const [value, caption] of field.options) input.append(option(value, caption));
          input.value = field.value || field.options[0]?.[0] || "";
        } else if (field.type === "textarea") {
          input = document.createElement("textarea"); input.rows = 3; input.maxLength = field.maxLength || 240; input.value = field.value || "";
        } else {
          input = document.createElement("input"); input.type = field.type || "text"; input.value = field.value || ""; if (field.maxLength) input.maxLength = field.maxLength;
        }
        input.name = field.name; if (field.required) input.required = true; label.append(input); form.append(label);
      }
      const actions = document.createElement("div"); actions.className = "radio-dialog-actions";
      const cancel = button("Отмена"); cancel.addEventListener("click", () => dialog.close());
      const submit = document.createElement("button"); submit.type = "submit"; submit.className = "primary"; submit.textContent = submitText;
      actions.append(cancel, submit); form.append(actions);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          const values = Object.fromEntries(new FormData(form).entries());
          const close = await onSubmit(values);
          if (close !== false) dialog.close();
        } finally { submit.disabled = false; }
      });
      return form;
    },
    destroy() { dialog.remove(); }
  };
}

export const RADIO_KIND_LABELS = KIND_LABEL;
export const RADIO_ROLE_LABELS = ROLE_LABEL;
export const RADIO_POLICY_LABELS = POLICY_LABEL;
