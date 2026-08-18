const STYLE_ID = "patap-map-enhancements-v1";
let controlsObserver = null;

function moveLegacyControlsIntoOverlay() {
  const layersPanel = document.querySelector(".map-layers-panel");
  if (!layersPanel || layersPanel.dataset.controlsMoved === "true") return false;
  const privacy = document.querySelector("#map-view .privacy-controls");
  const radius = document.querySelector("#map-view .radius-control");
  const gpsState = document.querySelector("#gps-state");
  const heading = document.createElement("strong");
  heading.textContent = "Driver и GPS";
  heading.className = "map-legacy-tools-title";
  layersPanel.append(heading);
  if (privacy) layersPanel.append(privacy);
  if (radius) {
    const radiusLabels = new Map([["5", "Рядом · 5 км"], ["25", "Район · 25 км"], ["50", "Далеко · 50 км"], ["100", "Очень далеко · 100 км"]]);
    const select = radius.querySelector("select");
    for (const option of select?.options || []) option.textContent = radiusLabels.get(option.value) || option.textContent;
    layersPanel.append(radius);
  }
  if (gpsState) layersPanel.append(gpsState);
  layersPanel.dataset.controlsMoved = "true";
  controlsObserver?.disconnect?.();
  controlsObserver = null;
  return true;
}

export function installMapUiStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#driver-map.driver-map{position:relative;isolation:isolate}.map-experience{position:absolute;inset:0;z-index:7;pointer-events:none;font:inherit}.map-experience button,.road-report-marker,.road-report-cluster,.driver-map-marker,.driver-map-cluster{touch-action:manipulation}.map-experience-top{position:absolute;top:10px;left:10px;display:flex;flex-wrap:wrap;gap:7px;max-width:calc(100% - 72px);pointer-events:auto}.map-experience-top>button{min-height:44px;padding:8px 12px;border:1px solid rgba(255,255,255,.24);border-radius:14px;background:rgba(7,17,14,.92);color:#f4f8f6;font-weight:800;box-shadow:0 4px 14px rgba(0,0,0,.28);backdrop-filter:blur(10px)}.map-experience-top>button[data-mode="FOLLOW"],.map-experience-top>button[data-mode="HEADING"]{border-color:#68e0ad;color:#68e0ad}.map-popover{position:absolute;top:62px;left:10px;width:min(310px,calc(100% - 20px));max-height:calc(100% - 82px);overflow:auto;padding:14px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:rgba(7,17,14,.96);color:#f4f8f6;box-shadow:0 12px 32px rgba(0,0,0,.38);backdrop-filter:blur(12px);pointer-events:auto}.map-popover strong{display:block;margin-bottom:10px}.map-popover p{margin:8px 0 0}.map-layer-row{display:flex;align-items:center;gap:10px;min-height:44px;color:#f4f8f6}.map-layer-row input{width:22px;min-height:22px;margin:0;accent-color:#68e0ad}.map-popover-note{color:#a9beb6;font-size:.78rem;line-height:1.35}.map-legacy-tools-title{margin-top:14px!important;padding-top:12px;border-top:1px solid rgba(255,255,255,.12)}.map-layers-panel .privacy-controls{display:block;margin:0 0 10px}.map-layers-panel .switch-row{padding:10px;background:#0a1914}.map-layers-panel .radius-control{width:100%;margin:8px 0}.map-layers-panel .radius-control select{min-height:44px}.map-layers-panel .gps-state{margin:8px 0 0;font-size:.78rem;line-height:1.35}.map-ahead{position:absolute;left:50%;top:10px;transform:translateX(-50%);width:min(360px,46vw);padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:rgba(7,17,14,.9);color:#f4f8f6;box-shadow:0 4px 16px rgba(0,0,0,.28);pointer-events:auto}.map-ahead>strong{display:block;margin:0 0 5px 4px;color:#a9beb6;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}.map-ahead-item{width:100%;min-height:38px;margin-top:4px;border:0;border-radius:10px;padding:6px 10px;background:#10251d;color:#f4f8f6;text-align:left;font-weight:750}.map-gps-quality{position:absolute;right:10px;bottom:50px;min-height:30px;display:flex;align-items:center;padding:5px 9px;border-radius:999px;background:rgba(7,17,14,.88);color:#d8e4df;font-size:.75rem;font-weight:800;box-shadow:0 3px 12px rgba(0,0,0,.26);pointer-events:none}.map-gps-quality[data-quality="good"]{color:#68e0ad}.map-gps-quality[data-quality="fair"]{color:#ffd27a}.map-gps-quality[data-quality="poor"]{color:#ffaaa2}.driver-map-marker{display:flex;align-items:center;gap:5px;min-height:38px;max-width:150px;padding:5px 8px;border:2px solid #fff;border-radius:13px 13px 13px 4px;background:#10251d;color:#f4f8f6;box-shadow:0 4px 12px rgba(0,0,0,.36);cursor:pointer}.driver-map-marker strong{flex:0 0 auto;color:#68e0ad;font-size:.68rem}.driver-map-marker span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem;font-weight:800}.driver-map-marker[data-driver-type="TAXI"] strong{color:#ffd27a}.driver-map-marker[data-driver-type="DELIVERY"] strong{color:#a9c7ff}.driver-map-cluster,.road-report-cluster{display:grid;place-items:center;width:42px;height:42px;border:3px solid #fff;border-radius:50%;background:#10251d;color:#68e0ad;font-weight:900;box-shadow:0 4px 13px rgba(0,0,0,.4);cursor:pointer}.road-report-cluster{background:#ffb454;color:#16120b}.road-report-marker[data-freshness="aging"]{filter:saturate(.82)}.road-report-marker[data-freshness="old"]{filter:saturate(.55)}@media(max-width:760px){.map-experience-top{right:52px;max-width:none}.map-experience-top>button{min-height:44px;padding:7px 10px;font-size:.78rem}.map-ahead{top:auto;bottom:76px;left:10px;transform:none;width:min(330px,calc(100% - 20px))}.map-ahead-item:nth-of-type(n+3){display:none}.map-gps-quality{right:8px;bottom:8px}.driver-map-marker{max-width:112px}.driver-map-marker span{display:none}}
  `;
  document.head.append(style);
  if (!moveLegacyControlsIntoOverlay() && globalThis.MutationObserver) {
    controlsObserver = new MutationObserver(() => moveLegacyControlsIntoOverlay());
    controlsObserver.observe(document.body, { childList: true, subtree: true });
  }
}
