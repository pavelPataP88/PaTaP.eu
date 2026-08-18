import { countryFlag } from "../shared/countries.js?v=20260714-10";
import { ensureMapLibre } from "./maplibre-loader.mjs?v=20260818-1";
import { createRoadReportPanel } from "./road-reports-panel.mjs?v=20260818-redesign1";
import { createMapExperience } from "./map-experience.mjs?v=20260818-mapv1";

const DRIVER_TYPE_LABELS = Object.freeze({
  TIR: "TIR",
  TAXI: "Taxi",
  DELIVERY: "Дост.",
  GENERAL: "Driver"
});

function driverMarkerElement(driver) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "driver-map-marker";
  button.dataset.driverType = driver.driverType || "GENERAL";
  button.setAttribute("aria-label", `${driver.nickname} · ${DRIVER_TYPE_LABELS[driver.driverType] || "Driver"} · ${driver.distanceKm ?? "?"} км`);
  const badge = document.createElement("strong");
  badge.textContent = DRIVER_TYPE_LABELS[driver.driverType] || "Driver";
  const name = document.createElement("span");
  name.textContent = `${countryFlag(driver.countryCode)} ${driver.nickname}`.trim();
  button.append(badge, name);
  return button;
}

function clusterNearbyDrivers(drivers, zoom) {
  if (!Array.isArray(drivers) || drivers.length < 2 || zoom >= 10) {
    return (drivers || []).map((driver) => ({ kind: "driver", key: `driver:${driver.nickname}`, driver }));
  }
  const cell = zoom < 7 ? 0.75 : zoom < 9 ? 0.3 : 0.12;
  const buckets = new Map();
  for (const driver of drivers) {
    const key = `${Math.round(driver.latitude / cell)}:${Math.round(driver.longitude / cell)}`;
    const bucket = buckets.get(key) || [];
    bucket.push(driver);
    buckets.set(key, bucket);
  }
  const result = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length === 1) {
      result.push({ kind: "driver", key: `driver:${bucket[0].nickname}`, driver: bucket[0] });
      continue;
    }
    result.push({
      kind: "cluster",
      key: `cluster:${key}`,
      count: bucket.length,
      latitude: bucket.reduce((sum, item) => sum + item.latitude, 0) / bucket.length,
      longitude: bucket.reduce((sum, item) => sum + item.longitude, 0) / bucket.length
    });
  }
  return result;
}

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
  let roadReports = null;
  let experience = null;
  let nearbyDrivers = [];
  const nearbyMarkers = new Map();
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
    if (!map || !mapLoaded || !ownLocation || !map.addSource || experience?.isLayerVisible("searchRadius") === false) {
      clearRadiusOverlay();
      return;
    }
    const data = { type: "FeatureCollection", features: [radiusPolygon(ownLocation, radiusKm)] };
    const source = map.getSource?.(radiusSourceId);
    if (source) source.setData(data);
    else {
      map.addSource(radiusSourceId, { type: "geojson", data });
      map.addLayer?.({ id: "driver-search-radius-fill", type: "fill", source: radiusSourceId, paint: { "fill-color": "#68e0ad", "fill-opacity": 0.08 } });
      map.addLayer?.({ id: "driver-search-radius-line", type: "line", source: radiusSourceId, paint: { "line-color": "#68e0ad", "line-opacity": 0.65, "line-width": 1.5 } });
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
    locationButton.title = ownLocation ? "Вернуться к моему местоположению и следить" : "Ожидаем GPS-позицию";
  }

  function recenterOwn() {
    if (!map || !ownLocation) return false;
    if (experience?.setFollowMode("FOLLOW")) return true;
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
        locationButton.setAttribute("aria-label", "Вернуться к моему местоположению и следить");
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

  function removeNearbyMarkers() {
    for (const marker of nearbyMarkers.values()) marker.remove();
    nearbyMarkers.clear();
  }

  function renderNearbyMarkers() {
    if (!map || experience?.isLayerVisible("drivers") === false) {
      removeNearbyMarkers();
      return;
    }
    const items = clusterNearbyDrivers(nearbyDrivers, map.getZoom?.() || config.zoom);
    const visible = new Set();
    for (const item of items) {
      visible.add(item.key);
      let marker = nearbyMarkers.get(item.key);
      if (!marker) {
        if (item.kind === "cluster") {
          const element = document.createElement("button");
          element.type = "button";
          element.className = "driver-map-cluster";
          element.textContent = String(item.count);
          element.setAttribute("aria-label", `${item.count} водителей рядом. Приблизить карту.`);
          element.addEventListener("click", () => map.easeTo?.({ center: [item.longitude, item.latitude], zoom: Math.min(config.maxZoom, (map.getZoom?.() || 8) + 2), duration: 350 }));
          marker = new window.maplibregl.Marker({ element }).setLngLat([item.longitude, item.latitude]).addTo(map);
        } else {
          const element = driverMarkerElement(item.driver);
          element.addEventListener("click", () => Promise.resolve(onDriverCard?.(item.driver.nickname)).catch(() => {}));
          marker = new window.maplibregl.Marker({ element, anchor: "bottom" })
            .setLngLat([item.driver.longitude, item.driver.latitude])
            .addTo(map);
        }
        nearbyMarkers.set(item.key, marker);
      } else if (item.kind === "cluster") {
        marker.setLngLat([item.longitude, item.latitude]);
      } else {
        marker.setLngLat([item.driver.longitude, item.driver.latitude]);
      }
    }
    for (const [key, marker] of nearbyMarkers) {
      if (!visible.has(key)) {
        marker.remove();
        nearbyMarkers.delete(key);
      }
    }
  }

  function handleLayerChange(key, visible) {
    if (key === "roadReports") roadReports?.setVisible?.(visible);
    if (key === "drivers") renderNearbyMarkers();
    if (key === "searchRadius") updateRadiusOverlay();
  }

  function applyAutoRadius(nextRadius) {
    if (![5, 25, 50, 100].includes(nextRadius)) return;
    setRadius(nextRadius, { focus: false });
    document.querySelector("#driver-map")?.dispatchEvent(new CustomEvent("patap:map-radius", { detail: { radius: nextRadius } }));
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
      if (map.on) map.on("load", () => { mapLoaded = true; updateRadiusOverlay(); experience?.setOwnLocation(ownLocation); });
      else mapLoaded = true;
      if (globalThis.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(document.querySelector("#driver-map"));
      }
      const mapElement = document.querySelector("#driver-map");
      experience = createMapExperience({
        map,
        mapElement,
        getOwnLocation: () => ownLocation ? { ...ownLocation } : null,
        onLayerChange: handleLayerChange,
        onAutoRadius: applyAutoRadius
      });
      roadReports = createRoadReportPanel({
        map,
        mapElement,
        api,
        getOwnLocation: () => ownLocation ? { ...ownLocation } : null,
        isProfileReady: () => profileReady,
        onAuthLost,
        showError,
        onReportsChanged: (reports) => experience?.setReports(reports),
        isVisible: () => experience?.isLayerVisible("roadReports") !== false
      });
      roadReports.setVisible?.(experience.isLayerVisible("roadReports"));
      map.on?.("zoomend", renderNearbyMarkers);
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
    experience?.clearOwnLocation();
    updateLocationControl();
  }

  function showOwn(location) {
    if (!map) return;
    ownLocation = {
      longitude: location.longitude,
      latitude: location.latitude,
      accuracy: location.accuracy,
      heading: typeof location.heading === "number" ? location.heading : null,
      speed: typeof location.speed === "number" ? location.speed : null,
      timestamp: typeof location.timestamp === "number" ? location.timestamp : Date.now()
    };
    const point = [location.longitude, location.latitude];
    if (!ownMarker) ownMarker = new window.maplibregl.Marker({ color: "#2f8cff" }).setLngLat(point).addTo(map);
    else ownMarker.setLngLat(point);
    updateLocationControl();
    updateRadiusOverlay();
    experience?.setOwnLocation(ownLocation);
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
    nearbyDrivers = Array.isArray(drivers) ? drivers.slice() : [];
    experience?.setDrivers(nearbyDrivers);
    renderNearbyMarkers();
  }

  function clearNearby() {
    nearbyDrivers = [];
    experience?.setDrivers([]);
    removeNearbyMarkers();
  }

  function setProfileReady(value) {
    profileReady = Boolean(value);
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
    refreshRoadReports() { return roadReports?.refresh?.(); },
    setProfileReady,
    getMapExperienceState() { return experience?.getState?.() || null; }
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
    reset() { controller.setProfileReady(false); }
  };
}
