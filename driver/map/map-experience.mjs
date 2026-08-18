const STORAGE_KEY = "patap_driver_map_preferences_v1";
const DEFAULT_LAYERS = Object.freeze({ roadReports: true, drivers: true, searchRadius: true });
const FOLLOW_MODES = Object.freeze(["FREE", "FOLLOW", "HEADING"]);

const REPORT_LABELS = Object.freeze({
  ACCIDENT: "ДТП",
  ROADWORK: "Работы",
  OBSTACLE: "Препятствие",
  ROAD_CONTROL: "Контроль",
  TRANSPORT_INSPECTION: "Инспекция"
});

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function haversineKm(fromLat, fromLon, toLat, toLon) {
  if (![fromLat, fromLon, toLat, toLon].every(finite)) return Infinity;
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371.0088;
  const latDelta = radians(toLat - fromLat);
  const lonDelta = radians(toLon - fromLon);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(lonDelta / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(fromLat, fromLon, toLat, toLon) {
  if (![fromLat, fromLon, toLat, toLon].every(finite)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const degrees = (value) => value * 180 / Math.PI;
  const lat1 = radians(fromLat);
  const lat2 = radians(toLat);
  const deltaLon = radians(toLon - fromLon);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export function angleDelta(left, right) {
  if (![left, right].every(finite)) return Infinity;
  return Math.abs((((left - right) % 360) + 540) % 360 - 180);
}

export function suggestRadiusForZoom(zoom) {
  if (!finite(zoom)) return 25;
  if (zoom >= 12) return 5;
  if (zoom >= 9) return 25;
  if (zoom >= 7) return 50;
  return 100;
}

export function gpsQuality(accuracy) {
  if (!finite(accuracy) || accuracy < 0) return { level: "unknown", label: "точность неизвестна" };
  if (accuracy <= 25) return { level: "good", label: `точность ±${Math.round(accuracy)} м` };
  if (accuracy <= 60) return { level: "fair", label: `точность ±${Math.round(accuracy)} м` };
  return { level: "poor", label: `низкая точность ±${Math.round(accuracy)} м` };
}

export function roadReportsAhead(reports, ownLocation, { limit = 3, maxDistanceKm = 10 } = {}) {
  if (!ownLocation || !finite(ownLocation.latitude) || !finite(ownLocation.longitude)) return [];
  const heading = finite(ownLocation.heading) && ownLocation.heading >= 0 ? ownLocation.heading : null;
  return (Array.isArray(reports) ? reports : [])
    .map((report) => {
      const distanceKm = haversineKm(ownLocation.latitude, ownLocation.longitude, report.latitude, report.longitude);
      const bearing = bearingDegrees(ownLocation.latitude, ownLocation.longitude, report.latitude, report.longitude);
      return { ...report, distanceKm, bearing };
    })
    .filter((report) => Number.isFinite(report.distanceKm) && report.distanceKm <= maxDistanceKm)
    .filter((report) => heading == null || report.distanceKm <= 0.15 || angleDelta(report.bearing, heading) <= 80)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, limit);
}

function readPreferences(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || "null");
    return {
      layers: { ...DEFAULT_LAYERS, ...(parsed?.layers || {}) },
      autoRadius: parsed?.autoRadius === true,
      followMode: FOLLOW_MODES.includes(parsed?.followMode) ? parsed.followMode : "FREE"
    };
  } catch {
    return { layers: { ...DEFAULT_LAYERS }, autoRadius: false, followMode: "FREE" };
  }
}

function writePreferences(storage, state) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify({
      layers: state.layers,
      autoRadius: state.autoRadius,
      followMode: state.followMode
    }));
  } catch {}
}

function makeButton(text, label = text) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  return button;
}

function makeAccuracyFeature(location) {
  const accuracyKm = Math.max(0.005, Math.min(1, Number(location.accuracy || 0) / 1000));
  const points = [];
  const earthRadiusKm = 6371.0088;
  const latitude = location.latitude * Math.PI / 180;
  const longitude = location.longitude * Math.PI / 180;
  const distance = accuracyKm / earthRadiusKm;
  for (let step = 0; step <= 48; step += 1) {
    const bearing = step * 2 * Math.PI / 48;
    const pointLatitude = Math.asin(Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing));
    const pointLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
      Math.cos(distance) - Math.sin(latitude) * Math.sin(pointLatitude)
    );
    points.push([pointLongitude * 180 / Math.PI, pointLatitude * 180 / Math.PI]);
  }
  return {
    type: "Feature",
    properties: { accuracy: location.accuracy },
    geometry: { type: "Polygon", coordinates: [points] }
  };
}

export function createMapExperience({
  map,
  mapElement,
  getOwnLocation,
  onLayerChange,
  onAutoRadius,
  storage = globalThis.localStorage
}) {
  const preferences = readPreferences(storage);
  const state = {
    layers: { ...preferences.layers },
    autoRadius: preferences.autoRadius,
    followMode: preferences.followMode,
    reports: [],
    drivers: [],
    ownLocation: null,
    accuracySourceReady: false
  };

  const overlay = document.createElement("div");
  overlay.className = "map-experience";
  overlay.dataset.mapExperience = "overlay";

  const topControls = document.createElement("div");
  topControls.className = "map-experience-top";

  const followButton = makeButton("Свободно", "Режим камеры: свободная карта");
  followButton.dataset.mapExperience = "follow";
  const layersButton = makeButton("Слои", "Настроить слои карты");
  layersButton.dataset.mapExperience = "layers";
  const nearbyButton = makeButton("Что рядом", "Показать сводку вокруг меня");
  nearbyButton.dataset.mapExperience = "nearby";
  topControls.append(followButton, layersButton, nearbyButton);

  const layersPanel = document.createElement("section");
  layersPanel.className = "map-popover map-layers-panel";
  layersPanel.hidden = true;
  layersPanel.setAttribute("aria-label", "Слои карты");

  const layerRows = [
    ["roadReports", "Дорожные события"],
    ["drivers", "Водители"],
    ["searchRadius", "Круг поиска"]
  ];
  for (const [key, label] of layerRows) {
    const row = document.createElement("label");
    row.className = "map-layer-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.layers[key] !== false;
    input.dataset.mapLayer = key;
    input.addEventListener("change", () => {
      state.layers[key] = input.checked;
      persist();
      onLayerChange?.(key, input.checked);
      updateSummary();
    });
    row.append(input, document.createTextNode(label));
    layersPanel.append(row);
  }
  const autoRow = document.createElement("label");
  autoRow.className = "map-layer-row";
  const autoInput = document.createElement("input");
  autoInput.type = "checkbox";
  autoInput.checked = state.autoRadius;
  autoInput.dataset.mapExperience = "auto-radius";
  autoInput.addEventListener("change", () => {
    state.autoRadius = autoInput.checked;
    persist();
    if (state.autoRadius) onAutoRadius?.(suggestRadiusForZoom(map.getZoom?.()));
  });
  autoRow.append(autoInput, document.createTextNode("Авторадиус по масштабу"));
  layersPanel.append(autoRow);
  const unavailable = document.createElement("p");
  unavailable.className = "map-popover-note";
  unavailable.textContent = "Парковки, топливо и сервисы появятся только после подключения проверенного источника данных.";
  layersPanel.append(unavailable);

  const nearbyPanel = document.createElement("section");
  nearbyPanel.className = "map-popover map-nearby-panel";
  nearbyPanel.hidden = true;
  nearbyPanel.setAttribute("aria-label", "Что рядом");

  const ahead = document.createElement("section");
  ahead.className = "map-ahead";
  ahead.dataset.mapExperience = "ahead";
  ahead.hidden = true;
  ahead.setAttribute("aria-live", "polite");

  const gpsBadge = document.createElement("div");
  gpsBadge.className = "map-gps-quality";
  gpsBadge.dataset.mapExperience = "gps-quality";
  gpsBadge.hidden = true;

  overlay.append(topControls, layersPanel, nearbyPanel, ahead, gpsBadge);
  mapElement.append(overlay);

  function persist() {
    writePreferences(storage, state);
  }

  function followLabel() {
    if (state.followMode === "FOLLOW") return ["Следить", "Режим камеры: следить за мной"];
    if (state.followMode === "HEADING") return ["По курсу", "Режим камеры: следить и поворачивать по направлению"];
    return ["Свободно", "Режим камеры: свободная карта"];
  }

  function updateFollowButton() {
    const [text, label] = followLabel();
    followButton.textContent = text;
    followButton.setAttribute("aria-label", label);
    followButton.dataset.mode = state.followMode;
  }

  function applyCamera({ animate = true } = {}) {
    const location = state.ownLocation || getOwnLocation?.();
    if (!location || state.followMode === "FREE") return false;
    const options = {
      center: [location.longitude, location.latitude],
      duration: animate ? 320 : 0
    };
    if (state.followMode === "HEADING" && finite(location.heading) && location.heading >= 0) {
      options.bearing = location.heading;
    } else if (state.followMode === "FOLLOW") {
      options.bearing = 0;
    }
    map.easeTo?.(options);
    return true;
  }

  function cycleFollowMode() {
    const index = FOLLOW_MODES.indexOf(state.followMode);
    state.followMode = FOLLOW_MODES[(index + 1) % FOLLOW_MODES.length];
    persist();
    updateFollowButton();
    applyCamera();
  }

  function setFreeFromGesture(event) {
    if (state.followMode === "FREE") return;
    if (event?.originalEvent === undefined) return;
    state.followMode = "FREE";
    persist();
    updateFollowButton();
  }

  function updateAccuracy(location) {
    const quality = gpsQuality(location?.accuracy);
    gpsBadge.hidden = !location;
    if (location) {
      gpsBadge.textContent = quality.label;
      gpsBadge.dataset.quality = quality.level;
    }
    if (!map?.addSource || !location) {
      if (!location && state.accuracySourceReady) {
        map.getSource?.("driver-gps-accuracy")?.setData({ type: "FeatureCollection", features: [] });
      }
      return;
    }
    const data = { type: "FeatureCollection", features: [makeAccuracyFeature(location)] };
    const source = map.getSource?.("driver-gps-accuracy");
    if (source) source.setData(data);
    else if (map.isStyleLoaded?.() !== false) {
      map.addSource("driver-gps-accuracy", { type: "geojson", data });
      map.addLayer?.({
        id: "driver-gps-accuracy-fill",
        type: "fill",
        source: "driver-gps-accuracy",
        paint: { "fill-color": "#2f8cff", "fill-opacity": 0.12 }
      });
      map.addLayer?.({
        id: "driver-gps-accuracy-line",
        type: "line",
        source: "driver-gps-accuracy",
        paint: { "line-color": "#2f8cff", "line-opacity": 0.5, "line-width": 1.5 }
      });
      state.accuracySourceReady = true;
    }
  }

  function updateAhead() {
    if (state.layers.roadReports === false) {
      ahead.hidden = true;
      return;
    }
    const items = roadReportsAhead(state.reports, state.ownLocation || getOwnLocation?.());
    ahead.replaceChildren();
    if (!items.length) {
      ahead.hidden = true;
      return;
    }
    const title = document.createElement("strong");
    title.textContent = "Впереди";
    ahead.append(title);
    for (const report of items) {
      const button = makeButton("", `${REPORT_LABELS[report.type] || "Событие"} через ${report.distanceKm.toFixed(report.distanceKm < 1 ? 1 : 0)} км`);
      button.className = "map-ahead-item";
      const distance = report.distanceKm < 1 ? `${Math.max(50, Math.round(report.distanceKm * 1000 / 50) * 50)} м` : `${report.distanceKm.toFixed(1)} км`;
      button.textContent = `${REPORT_LABELS[report.type] || "Событие"} · ${distance}`;
      button.addEventListener("click", () => map.easeTo?.({ center: [report.longitude, report.latitude], zoom: Math.max(13, map.getZoom?.() || 13), duration: 350 }));
      ahead.append(button);
    }
    ahead.hidden = false;
  }

  function updateSummary() {
    nearbyPanel.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "Что рядом";
    const reportsCount = state.layers.roadReports === false ? 0 : state.reports.length;
    const driversCount = state.layers.drivers === false ? 0 : state.drivers.length;
    const reportLine = document.createElement("p");
    reportLine.textContent = `Дорожные события: ${reportsCount}`;
    const driversLine = document.createElement("p");
    driversLine.textContent = `Водители: ${driversCount}`;
    const typeCounts = new Map();
    for (const driver of state.drivers) typeCounts.set(driver.driverType || "GENERAL", (typeCounts.get(driver.driverType || "GENERAL") || 0) + 1);
    const breakdown = document.createElement("p");
    breakdown.className = "map-popover-note";
    breakdown.textContent = [
      typeCounts.get("TIR") ? `TIR ${typeCounts.get("TIR")}` : "",
      typeCounts.get("TAXI") ? `Taxi ${typeCounts.get("TAXI")}` : "",
      typeCounts.get("DELIVERY") ? `Доставка ${typeCounts.get("DELIVERY")}` : ""
    ].filter(Boolean).join(" · ") || "Нет видимых водителей в выбранном радиусе";
    nearbyPanel.append(title, reportLine, driversLine, breakdown);
  }

  followButton.addEventListener("click", cycleFollowMode);
  layersButton.addEventListener("click", () => {
    layersPanel.hidden = !layersPanel.hidden;
    nearbyPanel.hidden = true;
  });
  nearbyButton.addEventListener("click", () => {
    updateSummary();
    nearbyPanel.hidden = !nearbyPanel.hidden;
    layersPanel.hidden = true;
  });

  map.on?.("dragstart", setFreeFromGesture);
  map.on?.("rotatestart", setFreeFromGesture);
  map.on?.("zoomend", () => {
    if (state.autoRadius) onAutoRadius?.(suggestRadiusForZoom(map.getZoom?.()));
  });

  updateFollowButton();

  return {
    setOwnLocation(location) {
      state.ownLocation = location ? { ...location } : null;
      updateAccuracy(state.ownLocation);
      applyCamera({ animate: true });
      updateAhead();
    },
    clearOwnLocation() {
      state.ownLocation = null;
      updateAccuracy(null);
      updateAhead();
    },
    setReports(reports) {
      state.reports = Array.isArray(reports) ? reports.slice() : [];
      updateAhead();
      updateSummary();
    },
    setDrivers(drivers) {
      state.drivers = Array.isArray(drivers) ? drivers.slice() : [];
      updateSummary();
    },
    isLayerVisible(key) {
      return state.layers[key] !== false;
    },
    setLayerVisible(key, visible) {
      if (!(key in state.layers)) return;
      state.layers[key] = Boolean(visible);
      const input = layersPanel.querySelector(`[data-map-layer="${key}"]`);
      if (input) input.checked = state.layers[key];
      persist();
      onLayerChange?.(key, state.layers[key]);
      updateAhead();
    },
    getFollowMode() { return state.followMode; },
    setFollowMode(mode) {
      if (!FOLLOW_MODES.includes(mode)) return false;
      state.followMode = mode;
      persist();
      updateFollowButton();
      applyCamera();
      return true;
    },
    getState() {
      return {
        layers: { ...state.layers },
        autoRadius: state.autoRadius,
        followMode: state.followMode,
        reports: state.reports.slice(),
        drivers: state.drivers.slice()
      };
    },
    destroy() {
      overlay.remove();
      try { map.off?.("dragstart", setFreeFromGesture); } catch {}
      try { map.off?.("rotatestart", setFreeFromGesture); } catch {}
    }
  };
}
