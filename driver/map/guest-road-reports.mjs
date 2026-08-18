import { ensureMapLibre } from "./maplibre-loader.mjs?v=20260818-1";

const TYPES = Object.freeze({
  ACCIDENT: "ДТП",
  ROADWORK: "РАБ",
  OBSTACLE: "!",
  ROAD_CONTROL: "К",
  TRANSPORT_INSPECTION: "ТИ"
});

let guestMapPromise = null;

function safeTitle(report) {
  const expires = report.expiresAt ? new Date(report.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return [TYPES[report.type] || "Дорожная отметка", expires ? `до ${expires}` : ""].filter(Boolean).join(" · ");
}

export function openGuestRoadReportMap({ api, showError }) {
  if (guestMapPromise) return guestMapPromise;
  guestMapPromise = (async () => {
    const container = document.querySelector(".guest-map");
    const config = JSON.parse(document.querySelector("#driver-map-config").textContent);
    if (!container) throw new Error("guest_map_missing");
    await ensureMapLibre();
    container.replaceChildren();
    const map = new window.maplibregl.Map({
      container,
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
    const data = await api("/api/driver/road-reports");
    for (const report of Array.isArray(data.reports) ? data.reports : []) {
      if (!TYPES[report.type]) continue;
      const element = document.createElement("span");
      element.textContent = TYPES[report.type];
      element.title = safeTitle(report);
      element.setAttribute("aria-label", safeTitle(report));
      element.style.display = "grid";
      element.style.placeItems = "center";
      element.style.minWidth = "34px";
      element.style.height = "34px";
      element.style.padding = "0 6px";
      element.style.borderRadius = "17px";
      element.style.border = "2px solid #ffffff";
      element.style.background = "#f59e0b";
      element.style.color = "#111827";
      element.style.fontWeight = "800";
      element.style.boxShadow = "0 2px 8px rgba(0,0,0,.35)";
      new window.maplibregl.Marker({ element }).setLngLat([report.longitude, report.latitude]).addTo(map);
    }
    return map;
  })().catch((error) => {
    guestMapPromise = null;
    showError?.("Не удалось открыть дорожные отметки.");
    throw error;
  });
  return guestMapPromise;
}

