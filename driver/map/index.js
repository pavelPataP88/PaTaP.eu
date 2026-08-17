import { countryFlag } from "../shared/countries.js?v=20260714-10";

let mapLibrePromise = null;

function ensureMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;
  mapLibrePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/maplibre/maplibre-gl.js?v=20260714-8";
    script.defer = true;
    script.addEventListener("load", () => {
      if (window.maplibregl) resolve(window.maplibregl);
      else reject(new Error("maplibre_unavailable"));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("maplibre_load_failed")), { once: true });
    document.head.append(script);
  }).catch((error) => {
    mapLibrePromise = null;
    throw error;
  });
  return mapLibrePromise;
}

export function createMapController({ setState, onDriverCard }) {
  const config = JSON.parse(document.querySelector("#driver-map-config").textContent);
  let map = null;
  let ownMarker = null;
  let ownLocation = null;
  let locationButton = null;
  let resizeObserver = null;
  let radiusKm = 25;
  let mapLoaded = false;
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

  async function init() {
    if (map) return true;
    if (!window.maplibregl) {
      try {
        await ensureMapLibre();
      } catch {
        setState("Не удалось загрузить карту. Чат, контакты и профиль продолжают работать.", "error");
        return false;
      }
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
      if (map.on) map.on("load", () => { mapLoaded = true; updateRadiusOverlay(); });
      else mapLoaded = true;
      if (globalThis.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(document.querySelector("#driver-map"));
      }
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

  return {
    init,
    resize() { if (map) map.resize(); },
    isReady() { return Boolean(map); },
    showOwn,
    setRadius,
    recenterOwn,
    clearOwn,
    showNearby,
    clearNearby
  };
}

export function createDriverModule(context) {
  const controller = createMapController({
    setState(text, state) { context.getModule("gps")?.controller?.setState(text, state); },
    onDriverCard(nickname) { return context.openDriverCard?.(nickname); }
  });
  return {
    controller,
    async activate() {
      await controller.init();
      window.setTimeout(() => controller.resize(), 0);
    }
  };
}
