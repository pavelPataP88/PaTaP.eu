const MAX_REPORT_DISTANCE_KM = 2;
const MIN_OWN_MARKER_SEPARATION_KM = 0.025;
const REFRESH_MS = 30_000;

export const ROAD_REPORT_TYPES = Object.freeze({
  ACCIDENT: { label: "ДТП", marker: "ДТП", lanes: true },
  ROADWORK: { label: "Дорожные работы", marker: "РАБ", lanes: true },
  OBSTACLE: { label: "Препятствие", marker: "!", lanes: false },
  ROAD_CONTROL: { label: "Дорожный контроль", marker: "К", lanes: false },
  TRANSPORT_INSPECTION: { label: "Транспортная инспекция", marker: "ТИ", lanes: false }
});

export const ROAD_REPORT_LANES = Object.freeze({
  ALL: "Все полосы",
  LEFT: "Левая",
  MIDDLE: "Средняя",
  RIGHT: "Правая",
  SHOULDER: "Обочина"
});

export function roadReportDistanceKm(from, to) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371.0088;
  const latDelta = radians(to.latitude - from.latitude);
  const lonDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateRoadReportPoint(ownLocation, point) {
  if (!ownLocation) return { ok: false, error: "location_required" };
  const distanceKm = roadReportDistanceKm(ownLocation, point);
  if (distanceKm > MAX_REPORT_DISTANCE_KM) return { ok: false, error: "too_far", distanceKm };
  if (distanceKm < MIN_OWN_MARKER_SEPARATION_KM) return { ok: false, error: "overlaps_own_marker", distanceKm };
  return { ok: true, distanceKm };
}

function reportTitle(report) {
  const type = ROAD_REPORT_TYPES[report.type]?.label || "Дорожная отметка";
  const lane = report.lane ? ROAD_REPORT_LANES[report.lane] : "";
  const expires = report.expiresAt ? new Date(report.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return [type, lane, expires ? `до ${expires}` : ""].filter(Boolean).join(" · ");
}

function createChoiceButton(label, value, onChoose) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "road-report-choice";
  button.textContent = label;
  button.dataset.value = value;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onChoose(value, button);
  });
  return button;
}

export function createRoadReportsOverlay({ map, mapElement, api, getOwnLocation, isProfileReady, onAuthLost, showError }) {
  let selectedType = null;
  let selectedLane = null;
  let armed = false;
  let timer = null;
  const markers = new Map();

  const overlay = document.createElement("div");
  overlay.className = "road-report-overlay";
  overlay.dataset.roadReports = "map-overlay";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "road-report-toggle";
  toggle.textContent = "+ событие";
  toggle.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "road-report-panel";
  panel.hidden = true;

  const typeRow = document.createElement("div");
  typeRow.className = "road-report-choice-row";
  const laneRow = document.createElement("div");
  laneRow.className = "road-report-choice-row road-report-lanes";
  laneRow.hidden = true;

  const hint = document.createElement("div");
  hint.className = "road-report-hint";
  hint.setAttribute("role", "status");
  hint.setAttribute("aria-live", "polite");
  hint.textContent = "Выберите тип события.";

  function markSelected(row, selected) {
    for (const button of row.querySelectorAll("button")) button.classList.toggle("active", button === selected);
  }

  for (const [type, config] of Object.entries(ROAD_REPORT_TYPES)) {
    typeRow.append(createChoiceButton(config.label, type, (value, button) => {
      selectedType = value;
      selectedLane = null;
      markSelected(typeRow, button);
      laneRow.hidden = !ROAD_REPORT_TYPES[value].lanes;
      markSelected(laneRow, null);
      armed = !ROAD_REPORT_TYPES[value].lanes;
      hint.textContent = armed ? "Нажмите нужную точку на карте." : "Выберите полосу.";
    }));
  }

  for (const [lane, label] of Object.entries(ROAD_REPORT_LANES)) {
    laneRow.append(createChoiceButton(label, lane, (value, button) => {
      selectedLane = value;
      markSelected(laneRow, button);
      armed = Boolean(selectedType);
      hint.textContent = "Нажмите нужную точку на карте.";
    }));
  }

  panel.append(typeRow, laneRow, hint);
  overlay.append(toggle, panel);
  mapElement.append(overlay);

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isProfileReady()) {
      hint.textContent = "Сначала войдите в Driver и создайте профиль.";
      return;
    }
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) hint.textContent = selectedType ? "Выберите точку на карте." : "Выберите тип события.";
  });

  async function confirmReport(report) {
    let status = null;
    if (window.confirm(`${reportTitle(report)}\n\nСобытие всё ещё актуально?`)) status = "ACTIVE";
    else if (window.confirm("Отметить, что события уже нет?")) status = "GONE";
    if (!status) return;
    try {
      const result = await api(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status } });
      hint.textContent = result.closed ? "Отметка закрыта." : status === "ACTIVE" ? "Актуальность подтверждена." : "Подтверждение учтено.";
      await refresh();
    } catch (error) {
      if (error.status === 401) onAuthLost?.();
      else showError?.("Не удалось подтвердить дорожную отметку.");
    }
  }

  function upsertMarker(report) {
    if (!report || !ROAD_REPORT_TYPES[report.type]) return;
    const existing = markers.get(report.id);
    if (existing) existing.remove();
    const element = document.createElement("button");
    element.type = "button";
    element.className = `road-report-marker road-report-marker-${report.type.toLowerCase()}`;
    element.dataset.roadReportMarker = String(report.id);
    element.textContent = ROAD_REPORT_TYPES[report.type].marker;
    element.title = reportTitle(report);
    element.setAttribute("aria-label", reportTitle(report));
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmReport(report);
    });
    const marker = new window.maplibregl.Marker({ element, anchor: "center" })
      .setLngLat([report.longitude, report.latitude])
      .addTo(map);
    markers.set(report.id, marker);
  }

  function showReports(reports = []) {
    const visible = new Set();
    for (const report of reports) {
      visible.add(report.id);
      upsertMarker(report);
    }
    for (const [id, marker] of markers) {
      if (!visible.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }

  async function refresh() {
    try {
      const data = await api("/api/driver/road-reports");
      showReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (error) {
      if (error.status === 401) onAuthLost?.();
    }
  }

  async function createAt(point) {
    if (!armed || !selectedType || !isProfileReady()) return false;
    const ownLocation = getOwnLocation();
    const validation = validateRoadReportPoint(ownLocation, point);
    if (!validation.ok) {
      if (validation.error === "location_required") hint.textContent = "Нужна свежая включённая GPS-позиция.";
      else if (validation.error === "too_far") hint.textContent = "Точка слишком далеко: выберите место не дальше 2 км от текущего GPS.";
      else hint.textContent = "Выберите точку чуть в стороне от синего GPS-маркера.";
      return false;
    }
    armed = false;
    hint.textContent = "Добавляем отметку…";
    const body = {
      type: selectedType,
      lane: ROAD_REPORT_TYPES[selectedType].lanes ? selectedLane : null,
      latitude: point.latitude,
      longitude: point.longitude
    };
    try {
      const data = await api("/api/driver/road-reports", { method: "POST", body });
      if (data.report) upsertMarker(data.report);
      hint.textContent = "Отметка добавлена. Значок уже на карте.";
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      return true;
    } catch (error) {
      armed = true;
      if (error.status === 401) onAuthLost?.();
      else if (error.message === "road_report_location_required") hint.textContent = "Нужна свежая включённая GPS-позиция.";
      else if (error.message === "road_report_too_far") hint.textContent = "Точка слишком далеко от текущего GPS.";
      else hint.textContent = "Не удалось добавить дорожную отметку.";
      return false;
    }
  }

  function handleMapClick(event) {
    if (!armed) return;
    const lng = Number(event?.lngLat?.lng);
    const lat = Number(event?.lngLat?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    createAt({ longitude: lng, latitude: lat });
  }

  map.on?.("click", handleMapClick);
  timer = window.setInterval(refresh, REFRESH_MS);

  return {
    refresh,
    showReports,
    createAt,
    destroy() {
      if (timer) window.clearInterval(timer);
      timer = null;
      map.off?.("click", handleMapClick);
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      overlay.remove();
    }
  };
}
