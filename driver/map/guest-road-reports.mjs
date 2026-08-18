import { ensureMapLibre } from "./maplibre-loader.mjs?v=20260818-1";
import { clusterRoadReports, reportFreshness } from "./road-reports-panel.mjs?v=20260818-mapv1";

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
  return [TYPES[report.type] || "Дорожная отметка", expires ? `до ${expires}` : ""].filter(Boolean).join(" · ");
}

function reportElement(report) {
  const element = document.createElement("span");
  const freshness = reportFreshness(report);
  element.textContent = TYPES[report.type];
  element.title = safeTitle(report);
  element.setAttribute("aria-label", safeTitle(report));
  Object.assign(element.style, {
    display: "grid",
    placeItems: "center",
    minWidth: "34px",
    height: "34px",
    padding: "0 6px",
    borderRadius: "17px",
    border: "2px solid #ffffff",
    background: "#f59e0b",
    color: "#111827",
    fontWeight: "800",
    opacity: String(freshness.opacity),
    boxShadow: "0 2px 8px rgba(0,0,0,.35)"
  });
  return element;
}

function clusterElement(count) {
  const element = document.createElement("span");
  element.textContent = String(count);
  element.setAttribute("aria-label", `${count} дорожных событий`);
  Object.assign(element.style, {
    display: "grid",
    placeItems: "center",
    width: "38px",
    height: "38px",
    borderRadius: "50%",
    border: "2px solid #ffffff",
    background: "#f59e0b",
    color: "#111827",
    fontWeight: "900",
    boxShadow: "0 2px 8px rgba(0,0,0,.35)"
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
    const reports = (Array.isArray(data.reports) ? data.reports : []).filter((report) => TYPES[report.type]);
    const markers = [];

    function render() {
      for (const marker of markers.splice(0)) marker.remove();
      for (const item of clusterRoadReports(reports, map.getZoom?.() || config.zoom)) {
        if (item.kind === "cluster") {
          markers.push(new window.maplibregl.Marker({ element: clusterElement(item.count) })
            .setLngLat([item.longitude, item.latitude])
            .addTo(map));
        } else {
          const report = item.report;
          markers.push(new window.maplibregl.Marker({ element: reportElement(report), anchor: "bottom", offset: [0, -18] })
            .setLngLat([report.longitude, report.latitude])
            .addTo(map));
        }
      }
    }

    render();
    map.on?.("zoomend", render);
    return map;
  })().catch((error) => {
    guestMapPromise = null;
    showError?.("Не удалось открыть дорожные отметки.");
    throw error;
  });
  return guestMapPromise;
}
