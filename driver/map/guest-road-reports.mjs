import { ensureMapLibre } from "./maplibre-loader.mjs?v=20260818-1";

const TYPES = Object.freeze({
  ACCIDENT: "ДТП",
  ROADWORK: "РБ",
  OBSTACLE: "!",
  ROAD_CONTROL: "К",
  TRANSPORT_INSPECTION: "ТИ"
});

let guestMapPromise = null;

function safeTitle(report) {
  const expires = report.expiresAt ? new Date(report.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return [TYPES[report.type] || "Событие", expires ? `до ${expires}` : ""].filter(Boolean).join(" · ");
}

function markerElement(report) {
  const element = document.createElement("span");
  element.textContent = TYPES[report.type];
  element.title = safeTitle(report);
  element.setAttribute("aria-label", safeTitle(report));
  Object.assign(element.style, {
    display: "grid",
    placeItems: "center",
    minWidth: "38px",
    height: "38px",
    padding: "0 6px",
    border: "3px solid #ffffff",
    borderRadius: "12px 12px 12px 4px",
    background: "#ffb454",
    color: "#16120b",
    fontWeight: "900",
    boxShadow: "0 4px 13px rgba(0,0,0,.42)"
  });
  return element;
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
      new window.maplibregl.Marker({ element: markerElement(report) })
        .setLngLat([report.longitude, report.latitude])
        .addTo(map);
    }
    return map;
  })().catch((error) => {
    guestMapPromise = null;
    showError?.("Не удалось открыть дорожные события.");
    throw error;
  });
  return guestMapPromise;
}
