import { countryFlag } from "../shared/countries.js?v=20260714-10";
import { ensureMapLibre } from "./maplibre-loader.mjs?v=20260818-1";

const ROAD_REPORT_REFRESH_MS = 30_000;
const ROAD_REPORT_TYPES = Object.freeze({
  ACCIDENT: { label: "ДТП", marker: "ДТП", lanes: true },
  ROADWORK: { label: "Дорожные работы", marker: "РАБ", lanes: true },
  OBSTACLE: { label: "Препятствие", marker: "!", lanes: false },
  ROAD_CONTROL: { label: "Дорожный контроль", marker: "К", lanes: false },
  TRANSPORT_INSPECTION: { label: "Транспортная инспекция", marker: "ТИ", lanes: false }
});
const ROAD_REPORT_LANES = Object.freeze({
  ALL: "Все полосы",
  LEFT: "Левая полоса",
  MIDDLE: "Средняя полоса",
  RIGHT: "Правая полоса",
  SHOULDER: "Обочина"
});

export function createMapController({ setState, onDriverCard, api, onAuthLost, showError }) {
  const config = JSON.parse(document.querySelector("#driver-map-config").textContent);
  let map = null;
  let ownMarker = null;
  let ownLocation = null;
  let locationButton = null;
  let resizeObserver = null;
  let radiusKm = 25;
  let mapLoaded = false;
  let profileReady = false;
  let roadReportTimer = null;
  let roadReportControls = null;
  const nearbyMarkers = new Map();
  const roadReportMarkers = new Map();
  const radiusSourceId = "driver-search-radius";

  function radiusPolygon(location, radius) {
    const points = [];
    const earthRadiusKm = 6371;
    const latitude = location.latitude * Math.PI / 180;
    const longitude = location.longitude * Math.PI / 180;
    const distance = radius / earthRadiusKm;
    for (let step = 0; step <= 64; step += 1) {
      const bearing = step * 2 * Math.PI / 64;
      const pointLatitude = Math.asin(Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing));
      const pointLongitude = longitude + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude), Math.cos(distance) - Math.sin(latitude) * Math.sin(pointLatitude));
      points.push([pointLongitude * 180 / Math.PI, pointLatitude * 180 / Math.PI]);
    }
    return { type: "Feature", properties: { radiusKm: radius }, geometry: { type: "Polygon", coordinates: [points] } };
  }

  function updateRadiusOverlay() {
    if (!map || !mapLoaded || !ownLocation || !map.addSource) return;
    const data = { type: "FeatureCollection", features: [radiusPolygon(ownLocation, radiusKm)] };
    const source = map.getSource?.(radiusSourceId);
    if (source) source.setData(data);
    else {
      map.addSource(radiusSourceId, { type: "geojson", data });
      map.addLayer?.({ id: "driver-search-radius-fill", type: "fill", source: radiusSourceId, paint: { "fill-color": "#68e0ad", "fill-opacity": 0.12 } });
      map.addLayer?.({ id: "driver-search-radius-line", type: "line", source: radiusSourceId, paint: { "line-color": "#68e0ad", "line-width": 2 } });
    }
  }

  function clearRadiusOverlay() {
    if (!map || !mapLoaded) return;
    map.getSource?.(radiusSourceId)?.setData({ type: "FeatureCollection", features: [] });
  }

  function radiusZoom(location, radius) {
    const mapSize = map?.getContainer?.().getBoundingClientRect?.() || { width: 360, height: 360 };
    const pixels = Math.max(120, Math.min(mapSize.width || 360, mapSize.height || 360) * 0.72);
    const metersPerPixel = radius * 2000 / pixels;
    const zoom = Math.log2((156543.03392 * Math.cos(location.latitude * Math.PI / 180)) / metersPerPixel);
    return Math.max(3, Math.min(config.maxZoom, zoom));
  }

  function updateLocationControl() {
    if (!locationButton) return;
    locationButton.disabled = !ownLocation;
    locationButton.title = ownLocation ? "Вернуться к моему местоположению" : "Ожидаем GPS-позицию";
  }

  function recenterOwn() {
    if (!map || !ownLocation) return false;
    map.easeTo({ center: [ownLocation.longitude, ownLocation.latitude], duration: 450 });
    return true;
  }

  function createLocationControl() {
    return {
      onAdd() {
        const container = document.createElement("div");
        container.className = "maplibregl-ctrl maplibregl-ctrl-group driver-location-control";
        locationButton = document.createElement("button");
        locationButton.id = "map-locate";
        locationButton.type = "button";
        locationButton.setAttribute("aria-label", "Вернуться к моему местоположению");
        locationButton.textContent = "⌖";
        locationButton.addEventListener("click", recenterOwn);
        container.append(locationButton);
        updateLocationControl();
        return container;
      },
      onRemove() {
        locationButton = null;
      }
    };
  }

  function clearRoadReports() {
    for (const marker of roadReportMarkers.values()) marker.remove();
    roadReportMarkers.clear();
  }

  function roadReportTitle(report) {
    const type = ROAD_REPORT_TYPES[report.type]?.label || "Дорожная отметка";
    const lane = report.lane ? ROAD_REPORT_LANES[report.lane] : "";
    const expires = report.expiresAt ? new Date(report.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    return [type, lane, expires ? `до ${expires}` : ""].filter(Boolean).join(" · ");
  }

  async function confirmRoadReport(report) {
    let status = null;
    if (window.confirm(`${roadReportTitle(report)}\n\nСобытие всё ещё актуально?`)) status = "ACTIVE";
    else if (window.confirm("Отметить, что события уже нет?")) status = "GONE";
    if (!status) return;
    try {
      const data = await api(`/api/driver/road-reports/${report.id}/confirm`, { method: "POST", body: { status } });
      if (roadReportControls) {
        roadReportControls.status.textContent = data.closed ? "Отметка закрыта." : status === "ACTIVE" ? "Актуальность подтверждена." : "Ваше подтверждение учтено.";
      }
      await refreshRoadReports();
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else showError?.("Не удалось подтвердить дорожную отметку.");
    }
  }

  function showRoadReports(reports = []) {
    if (!map) return;
    clearRoadReports();
    for (const report of reports) {
      if (!ROAD_REPORT_TYPES[report.type]) continue;
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = ROAD_REPORT_TYPES[report.type].marker;
      element.title = roadReportTitle(report);
      element.setAttribute("aria-label", roadReportTitle(report));
      element.style.minWidth = "34px";
      element.style.height = "34px";
      element.style.padding = "0 6px";
      element.style.borderRadius = "17px";
      element.style.border = "2px solid #ffffff";
      element.style.background = "#f59e0b";
      element.style.color = "#111827";
      element.style.fontWeight = "800";
      element.style.boxShadow = "0 2px 8px rgba(0,0,0,.35)";
      element.style.cursor = "pointer";
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        confirmRoadReport(report);
      });
      const marker = new window.maplibregl.Marker({ element })
        .setLngLat([report.longitude, report.latitude])
        .addTo(map);
      roadReportMarkers.set(report.id, marker);
    }
  }

  async function refreshRoadReports() {
    if (!profileReady || !map) {
      clearRoadReports();
      return;
    }
    try {
      const data = await api("/api/driver/road-reports");
      showRoadReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else showError?.("Не удалось обновить дорожные отметки.");
    }
  }

  function updateRoadReportLane(typeSelect, laneWrap, laneSelect) {
    const lanes = Boolean(ROAD_REPORT_TYPES[typeSelect.value]?.lanes);
    laneWrap.hidden = !lanes;
    laneSelect.disabled = !lanes;
  }

  function createRoadReportControls() {
    if (roadReportControls) return;
    const mapElement = document.querySelector("#driver-map");
    if (!mapElement?.parentElement) return;
    const container = document.createElement("div");
    container.dataset.roadReports = "controls";
    container.className = "privacy-controls";

    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Дорожная отметка ";
    const typeSelect = document.createElement("select");
    typeSelect.setAttribute("aria-label", "Тип дорожной отметки");
    for (const [value, config] of Object.entries(ROAD_REPORT_TYPES)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = config.label;
      typeSelect.append(option);
    }
    typeLabel.append(typeSelect);

    const laneWrap = document.createElement("label");
    laneWrap.textContent = " Полоса ";
    const laneSelect = document.createElement("select");
    laneSelect.setAttribute("aria-label", "Затронутая полоса");
    for (const [value, label] of Object.entries(ROAD_REPORT_LANES)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      laneSelect.append(option);
    }
    laneWrap.append(laneSelect);

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Отметить здесь";
    add.disabled = !profileReady;
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    typeSelect.addEventListener("change", () => updateRoadReportLane(typeSelect, laneWrap, laneSelect));
    add.addEventListener("click", async () => {
      if (!profileReady) return;
      if (!ownLocation) {
        status.textContent = "Сначала включите Driver/GPS и дождитесь позиции.";
        return;
      }
      const config = ROAD_REPORT_TYPES[typeSelect.value];
      const body = {
        type: typeSelect.value,
        lane: config?.lanes ? laneSelect.value : null,
        latitude: ownLocation.latitude,
        longitude: ownLocation.longitude
      };
      add.disabled = true;
      status.textContent = "Добавляем отметку…";
      try {
        await api("/api/driver/road-reports", { method: "POST", body });
        status.textContent = "Дорожная отметка добавлена в текущей позиции.";
        await refreshRoadReports();
      } catch (error) {
        if (error.status === 401) onAuthLost();
        else if (error.message === "road_report_location_required") status.textContent = "Нужна свежая включённая GPS-позиция.";
        else if (error.message === "road_report_too_far") status.textContent = "Точка слишком далеко от текущей GPS-позиции.";
        else status.textContent = "Не удалось добавить дорожную отметку.";
      } finally {
        add.disabled = !profileReady;
      }
    });

    container.append(typeLabel, laneWrap, add, status);
    mapElement.parentElement.insertBefore(container, mapElement);
    roadReportControls = { container, typeSelect, laneWrap, laneSelect, add, status };
    updateRoadReportLane(typeSelect, laneWrap, laneSelect);
  }

  function scheduleRoadReports() {
    if (roadReportTimer) window.clearInterval(roadReportTimer);
    roadReportTimer = profileReady ? window.setInterval(refreshRoadReports, ROAD_REPORT_REFRESH_MS) : null;
  }

  async function init() {
    if (map) return true;
    try {
      await ensureMapLibre();
    } catch {
      setState("Не удалось загрузить карту. Чат, контакты и профиль продолжают работать.", "error");
      return false;
    }
    try {
      map = new window.maplibregl.Map({
        container: "driver-map",
        center: config.center,
        zoom: config.zoom,
        maxZoom: config.maxZoom,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            basemap: {
              type: "raster",
              tiles: config.tiles,
              tileSize: 256,
              maxzoom: config.maxZoom,
              attribution: config.attribution
            }
          },
          layers: [{ id: "basemap", type: "raster", source: "basemap" }]
        }
      });
      map.addControl(new window.maplibregl.AttributionControl({ compact: false, customAttribution: config.attribution }));
      map.addControl(createLocationControl(), "top-right");
      if (map.on) map.on("load", () => { mapLoaded = true; updateRadiusOverlay(); refreshRoadReports(); });
      else mapLoaded = true;
      if (globalThis.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(document.querySelector("#driver-map"));
      }
      createRoadReportControls();
      scheduleRoadReports();
      await refreshRoadReports();
      return true;
    } catch {
      map = null;
      setState("Не удалось запустить интерактивную карту. Профиль и чат остаются доступны.", "error");
      return false;
    }
  }

  function clearOwn() {
    if (ownMarker) ownMarker.remove();
    ownMarker = null;
    ownLocation = null;
    clearRadiusOverlay();
    updateLocationControl();
  }

  function showOwn(location) {
    if (!map) return;
    ownLocation = { longitude: location.longitude, latitude: location.latitude };
    const point = [location.longitude, location.latitude];
    if (!ownMarker) ownMarker = new window.maplibregl.Marker({ color: "#2f8cff" }).setLngLat(point).addTo(map);
    else ownMarker.setLngLat(point);
    updateLocationControl();
    updateRadiusOverlay();
  }

  function setRadius(nextRadius, { focus = false } = {}) {
    if (!Number.isFinite(nextRadius) || nextRadius <= 0) return false;
    radiusKm = nextRadius;
    updateRadiusOverlay();
    if (focus && map && ownLocation) {
      map.easeTo({ center: [ownLocation.longitude, ownLocation.latitude], zoom: radiusZoom(ownLocation, radiusKm), duration: 450 });
      return true;
    }
    return false;
  }

  function showNearby(drivers) {
    if (!map) return;
    const visible = new Set();
    for (const driver of drivers) {
      visible.add(driver.nickname);
      const point = [driver.longitude, driver.latitude];
      let marker = nearbyMarkers.get(driver.nickname);
      if (!marker) {
        marker = new window.maplibregl.Marker({ color: "#68e0ad" }).setLngLat(point).addTo(map);
        marker.getElement?.().addEventListener("click", () => {
          Promise.resolve(onDriverCard?.(driver.nickname)).catch(() => {});
        });
        nearbyMarkers.set(driver.nickname, marker);
      } else {
        marker.setLngLat(point);
      }
    }
    for (const [nickname, marker] of nearbyMarkers) {
      if (!visible.has(nickname)) {
        marker.remove();
        nearbyMarkers.delete(nickname);
      }
    }
  }

  function clearNearby() {
    for (const marker of nearbyMarkers.values()) marker.remove();
    nearbyMarkers.clear();
  }

  function setProfileReady(value) {
    profileReady = Boolean(value);
    if (roadReportControls) roadReportControls.add.disabled = !profileReady;
    scheduleRoadReports();
    if (!profileReady) clearRoadReports();
  }

  function resetRoadReports() {
    profileReady = false;
    if (roadReportTimer) window.clearInterval(roadReportTimer);
    roadReportTimer = null;
    clearRoadReports();
    if (roadReportControls) {
      roadReportControls.add.disabled = true;
      roadReportControls.status.textContent = "";
    }
  }

  return {
    init,
    resize() { if (map) map.resize(); },
    isReady() { return Boolean(map); },
    showOwn,
    setRadius,
    recenterOwn,
    clearOwn,
    showNearby,
    clearNearby,
    refreshRoadReports,
    showRoadReports,
    setProfileReady,
    resetRoadReports
  };
}

export function createDriverModule(context) {
  const controller = createMapController({
    api: context.api,
    onAuthLost: context.onAuthLost,
    showError: context.showError,
    setState(text, state) { context.getModule("gps")?.controller?.setState(text, state); },
    onDriverCard(nickname) { return context.openDriverCard?.(nickname); }
  });
  return {
    controller,
    async activate() {
      await controller.init();
      await controller.refreshRoadReports();
      window.setTimeout(() => controller.resize(), 0);
    },
    setSession({ profile }) { controller.setProfileReady(Boolean(profile)); },
    setProfileReady(profile) { controller.setProfileReady(Boolean(profile)); },
    reset() { controller.resetRoadReports(); }
  };
}
