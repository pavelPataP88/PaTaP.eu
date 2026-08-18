const REFRESH_MS = 30_000;

export const ROAD_REPORT_TYPES = Object.freeze({
  ACCIDENT: { label: "ДТП", short: "ДТП", lanes: true },
  ROADWORK: { label: "Работы", short: "РБ", lanes: true },
  OBSTACLE: { label: "Препятствие", short: "!", lanes: false },
  ROAD_CONTROL: { label: "Контроль", short: "К", lanes: false },
  TRANSPORT_INSPECTION: { label: "Инспекция", short: "ТИ", lanes: false }
});

export const ROAD_REPORT_LANES = Object.freeze({
  ALL: "Все",
  LEFT: "Левая",
  MIDDLE: "Средняя",
  RIGHT: "Правая",
  SHOULDER: "Обочина"
});

function formatExpiry(expiresAt) {
  if (!expiresAt) return "";
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "истекает";
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  if (minutes < 60) return `ещё ~${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const tail = minutes % 60;
  return tail ? `ещё ~${hours} ч ${tail} мин` : `ещё ~${hours} ч`;
}

function makeButton(text, ariaLabel = text) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", ariaLabel);
  Object.assign(button.style, {
    minHeight: "48px",
    border: "1px solid rgba(255,255,255,.22)",
    borderRadius: "14px",
    padding: "10px 14px",
    background: "#10251d",
    color: "#f4f8f6",
    fontWeight: "800",
    cursor: "pointer",
    touchAction: "manipulation"
  });
  return button;
}

function roadReportTitle(report) {
  const type = ROAD_REPORT_TYPES[report.type]?.label || "Событие";
  const lane = report.lane ? ROAD_REPORT_LANES[report.lane] : "";
  return [type, lane, formatExpiry(report.expiresAt)].filter(Boolean).join(" · ");
}

export function createRoadReportPanel({ map, mapElement, api, getOwnLocation, isProfileReady, onAuthLost, showError }) {
  const reportMarkers = new Map();
  let selectedType = null;
  let selectedLane = null;
  let selectedReport = null;
  let timer = null;

  const overlay = document.createElement("div");
  overlay.dataset.roadReports = "overlay";
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    zIndex: "8",
    pointerEvents: "none"
  });

  const start = makeButton("+ событие", "Добавить дорожное событие");
  start.dataset.roadReports = "start";
  Object.assign(start.style, {
    position: "absolute",
    left: "12px",
    bottom: "14px",
    minHeight: "52px",
    borderRadius: "18px",
    background: "#f4f8f6",
    color: "#07110e",
    boxShadow: "0 4px 18px rgba(0,0,0,.32)",
    pointerEvents: "auto"
  });

  const sheet = document.createElement("section");
  sheet.dataset.roadReports = "sheet";
  sheet.hidden = true;
  sheet.setAttribute("aria-label", "Дорожное событие");
  Object.assign(sheet.style, {
    position: "absolute",
    left: "10px",
    right: "10px",
    bottom: "10px",
    maxWidth: "560px",
    margin: "0 auto",
    padding: "14px",
    border: "1px solid rgba(255,255,255,.18)",
    borderRadius: "20px",
    background: "rgba(7,17,14,.96)",
    boxShadow: "0 12px 36px rgba(0,0,0,.42)",
    backdropFilter: "blur(12px)",
    pointerEvents: "auto"
  });

  const heading = document.createElement("strong");
  heading.style.display = "block";
  heading.style.marginBottom = "10px";

  const choices = document.createElement("div");
  Object.assign(choices.style, {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px"
  });

  const status = document.createElement("div");
  status.dataset.roadReports = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  Object.assign(status.style, {
    minHeight: "20px",
    marginTop: "10px",
    color: "#a9beb6",
    fontSize: ".86rem"
  });

  const cancel = makeButton("Отмена", "Отменить добавление события");
  Object.assign(cancel.style, { width: "100%", marginTop: "8px", background: "transparent" });

  sheet.append(heading, choices, status, cancel);
  overlay.append(start, sheet);
  mapElement.append(overlay);

  function closeSheet(message = "") {
    sheet.hidden = true;
    start.hidden = false;
    selectedType = null;
    selectedLane = null;
    selectedReport = null;
    choices.replaceChildren();
    if (message) status.textContent = message;
  }

  function openSheet(title) {
    heading.textContent = title;
    choices.replaceChildren();
    status.textContent = "";
    start.hidden = true;
    sheet.hidden = false;
  }

  function markerElement(report) {
    const element = document.createElement("button");
    element.type = "button";
    element.dataset.roadReportMarker = String(report.id);
    element.textContent = ROAD_REPORT_TYPES[report.type]?.short || "!";
    element.title = roadReportTitle(report);
    element.setAttribute("aria-label", roadReportTitle(report));
    Object.assign(element.style, {
      display: "grid",
      placeItems: "center",
      minWidth: "42px",
      height: "42px",
      padding: "0 7px",
      border: "3px solid #ffffff",
      borderRadius: "14px 14px 14px 4px",
      background: "#ffb454",
      color: "#16120b",
      fontWeight: "900",
      boxShadow: "0 4px 13px rgba(0,0,0,.42)",
      cursor: "pointer"
    });
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      openConfirmReport(report);
    });
    return element;
  }

  function upsertMarker(report) {
    if (!report?.id || !ROAD_REPORT_TYPES[report.type]) return;
    const previous = reportMarkers.get(report.id);
    if (previous) previous.remove();
    const marker = new window.maplibregl.Marker({
      element: markerElement(report),
      anchor: "bottom",
      offset: [0, -30]
    }).setLngLat([report.longitude, report.latitude]).addTo(map);
    reportMarkers.set(report.id, marker);
  }

  function showReports(reports = []) {
    const visible = new Set();
    for (const report of reports) {
      if (!ROAD_REPORT_TYPES[report.type]) continue;
      visible.add(report.id);
      upsertMarker(report);
    }
    for (const [id, marker] of reportMarkers) {
      if (!visible.has(id)) {
        marker.remove();
        reportMarkers.delete(id);
      }
    }
  }

  async function refresh() {
    if (!map) return;
    try {
      const data = await api("/api/driver/road-reports");
      showReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (error) {
      if (error.status === 401) onAuthLost?.();
      else showError?.("Не удалось обновить дорожные события.");
    }
  }

  function showCreateConfirmation() {
    const type = ROAD_REPORT_TYPES[selectedType];
    openSheet("Создать событие здесь?");
    const summary = document.createElement("div");
    summary.textContent = [type?.label, selectedLane ? ROAD_REPORT_LANES[selectedLane] : "без уточнения полосы", "текущая GPS-позиция"].filter(Boolean).join(" · ");
    Object.assign(summary.style, { gridColumn: "1 / -1", color: "#d8e4df", padding: "4px 2px 8px" });
    const create = makeButton("Создать сейчас", "Создать дорожное событие в текущей GPS-позиции");
    Object.assign(create.style, { gridColumn: "1 / -1", background: "#68e0ad", color: "#07110e" });
    choices.append(summary, create);
    create.addEventListener("click", async () => {
      if (!isProfileReady?.()) return;
      const location = getOwnLocation?.();
      if (!location) {
        status.textContent = "Нужна включённая свежая GPS-позиция.";
        return;
      }
      create.disabled = true;
      status.textContent = "Создаём событие…";
      try {
        const data = await api("/api/driver/road-reports", {
          method: "POST",
          body: {
            type: selectedType,
            lane: selectedLane,
            latitude: location.latitude,
            longitude: location.longitude
          }
        });
        upsertMarker(data.report);
        const message = `Добавлено: ${roadReportTitle(data.report)}.`;
        closeSheet();
        status.textContent = message;
        start.title = message;
      } catch (error) {
        if (error.status === 401) onAuthLost?.();
        else if (error.message === "road_report_location_required") status.textContent = "GPS-позиция устарела. Дождитесь нового определения места.";
        else if (error.message === "road_report_too_far") status.textContent = "Сервер отклонил позицию как слишком далёкую от свежего GPS.";
        else status.textContent = "Не удалось создать событие.";
      } finally {
        create.disabled = false;
      }
    });
  }

  function showLaneChoices() {
    openSheet("Полоса — необязательно");
    const noLane = makeButton("Без уточнения", "Создать без уточнения полосы");
    noLane.dataset.roadLane = "NONE";
    choices.append(noLane);
    noLane.addEventListener("click", () => {
      selectedLane = null;
      showCreateConfirmation();
    });
    for (const [value, label] of Object.entries(ROAD_REPORT_LANES)) {
      const button = makeButton(label, `Полоса: ${label}`);
      button.dataset.roadLane = value;
      choices.append(button);
      button.addEventListener("click", () => {
        selectedLane = value;
        showCreateConfirmation();
      });
    }
  }

  function showTypeChoices() {
    openSheet("Что происходит рядом?");
    for (const [value, config] of Object.entries(ROAD_REPORT_TYPES)) {
      const button = makeButton(config.label, `Тип события: ${config.label}`);
      button.dataset.roadType = value;
      choices.append(button);
      button.addEventListener("click", () => {
        selectedType = value;
        selectedLane = null;
        if (config.lanes) showLaneChoices();
        else showCreateConfirmation();
      });
    }
  }

  async function sendConfirmation(statusValue) {
    if (!selectedReport) return;
    status.textContent = "Отправляем подтверждение…";
    try {
      const data = await api(`/api/driver/road-reports/${selectedReport.id}/confirm`, {
        method: "POST",
        body: { status: statusValue }
      });
      if (data.closed) {
        reportMarkers.get(selectedReport.id)?.remove();
        reportMarkers.delete(selectedReport.id);
      } else if (data.report) {
        upsertMarker(data.report);
      }
      closeSheet();
      start.title = data.closed ? "Событие снято с карты." : "Подтверждение учтено.";
    } catch (error) {
      if (error.status === 401) onAuthLost?.();
      else if (error.message === "road_report_location_required") status.textContent = "Для подтверждения нужна свежая включённая GPS-позиция.";
      else if (error.message === "road_report_too_far") status.textContent = "Подтвердить можно только рядом с событием.";
      else status.textContent = "Не удалось отправить подтверждение.";
    }
  }

  function openConfirmReport(report) {
    selectedReport = report;
    openSheet(roadReportTitle(report));
    const active = makeButton("Ещё актуально", "Подтвердить, что событие ещё актуально");
    const gone = makeButton("Уже нет", "Сообщить, что события уже нет");
    active.dataset.roadConfirm = "ACTIVE";
    gone.dataset.roadConfirm = "GONE";
    Object.assign(active.style, { background: "#68e0ad", color: "#07110e" });
    choices.append(active, gone);
    active.addEventListener("click", () => sendConfirmation("ACTIVE"));
    gone.addEventListener("click", () => sendConfirmation("GONE"));
  }

  start.addEventListener("click", () => {
    if (!isProfileReady?.()) {
      start.title = "Сначала создайте Driver-профиль.";
      return;
    }
    if (!getOwnLocation?.()) {
      start.title = "Включите GPS и дождитесь свежей позиции.";
      return;
    }
    showTypeChoices();
  });
  cancel.addEventListener("click", () => closeSheet());

  timer = window.setInterval(refresh, REFRESH_MS);
  refresh();

  return {
    refresh,
    upsertMarker,
    setProfileReady() {},
    destroy() {
      if (timer) window.clearInterval(timer);
      for (const marker of reportMarkers.values()) marker.remove();
      reportMarkers.clear();
      overlay.remove();
    }
  };
}
