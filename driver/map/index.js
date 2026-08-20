import { countryFlag } from "../shared/countries.js?v=20260714-10";
import { ensureMapLibre } from "./maplibre-loader.mjs?v=20260818-1";
import { createRoadReportPanel } from "./road-reports-panel.mjs?v=20260818-redesign1";
import { createMapExperience } from "./map-experience.mjs?v=20260818-mapv1";
import { installMapUiStyles } from "./map-ui-styles.mjs?v=20260818-mapv1";

const INITIAL_MAP_ZOOM = 11;
const GPS_FOCUS_ZOOM = 14;
const PARKING_FOCUS_ZOOM = 15;
const DRIVER_TYPE_LABELS = Object.freeze({ TIR: "TIR", TAXI: "Taxi", DELIVERY: "Дост.", GENERAL: "Driver" });

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

function parkingMarkerElement(place) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "parking-map-marker";
  button.dataset.parkingStatus = place.occupancy?.status || "UNKNOWN";
  button.setAttribute("aria-label", `Паркинг ${place.name} · ${place.occupancy?.status || "UNKNOWN"}`);
  const icon = document.createElement("strong");
  icon.textContent = "P";
  const name = document.createElement("span");
  name.textContent = place.name;
  button.append(icon, name);
  return button;
}

function clusterNearbyDrivers(drivers, zoom) {
  if (!Array.isArray(drivers) || drivers.length < 2 || zoom >= 10) return (drivers || []).map((driver) => ({ kind: "driver", key: `driver:${driver.nickname}`, driver }));
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
    if (bucket.length === 1) result.push({ kind: "driver", key: `driver:${bucket[0].nickname}`, driver: bucket[0] });
    else result.push({ kind: "cluster", key: `cluster:${key}`, count: bucket.length, latitude: bucket.reduce((sum, item) => sum + item.latitude, 0) / bucket.length, longitude: bucket.reduce((sum, item) => sum + item.longitude, 0) / bucket.length });
  }
  return result;
}

export function createMapController({ setState, onDriverCard, api, onAuthLost, showError }) {
  installMapUiStyles();
  const config = JSON.parse(document.querySelector("#driver-map-config").textContent);
  let map = null;
  let ownMarker = null;
  let parkingMarker = null;
  let focusedParking = null;
  let ownLocation = null;
  let locationButton = null;
  let resizeObserver = null;
  let radiusKm = 25;
  let mapLoaded = false;
  let profileReady = false;
  let roadReports = null;
  let experience = null;
  let nearbyDrivers = [];
  let initialGpsFocused = false;
  let navigationGeometry = [];
  let navigationProgress = 0;
  const nearbyMarkers = new Map();
  const radiusSourceId = "driver-search-radius";
  const navigationSourceId = "driver-navigation-route";
  const navigationProgressSourceId = "driver-navigation-progress";

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
    if (!map || !mapLoaded || !ownLocation || !map.addSource || experience?.isLayerVisible("searchRadius") === false) { clearRadiusOverlay(); return; }
    const data = { type: "FeatureCollection", features: [radiusPolygon(ownLocation, radiusKm)] };
    const source = map.getSource?.(radiusSourceId);
    if (source) source.setData(data);
    else {
      map.addSource(radiusSourceId, { type: "geojson", data });
      map.addLayer?.({ id: "driver-search-radius-fill", type: "fill", source: radiusSourceId, paint: { "fill-color": "#68e0ad", "fill-opacity": 0.08 } });
      map.addLayer?.({ id: "driver-search-radius-line", type: "line", source: radiusSourceId, paint: { "line-color": "#68e0ad", "line-opacity": 0.65, "line-width": 1.5 } });
    }
  }

  function clearRadiusOverlay() { if (map && mapLoaded) map.getSource?.(radiusSourceId)?.setData({ type: "FeatureCollection", features: [] }); }

  function validNavigationGeometry(geometry) {
    if (!Array.isArray(geometry) || geometry.length < 2 || geometry.length > 50000) return [];
    const points = [];
    for (const point of geometry) {
      const longitude = Number(point?.[0]), latitude = Number(point?.[1]);
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return [];
      points.push([longitude, latitude]);
    }
    return points;
  }

  function navigationProgressGeometry() {
    if (navigationGeometry.length < 2 || navigationProgress <= 0) return [];
    if (navigationProgress >= 1) return navigationGeometry.slice();
    const radians=(value)=>value*Math.PI/180,haversine=(a,b)=>{const dLat=radians(b[1]-a[1]),dLon=radians(b[0]-a[0]),x=Math.sin(dLat/2)**2+Math.cos(radians(a[1]))*Math.cos(radians(b[1]))*Math.sin(dLon/2)**2;return 6371.0088*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
    const lengths=[];let total=0;for(let i=1;i<navigationGeometry.length;i++){const length=haversine(navigationGeometry[i-1],navigationGeometry[i]);lengths.push(length);total+=length;}if(total<=0)return[];
    const target=total*navigationProgress,out=[navigationGeometry[0]];let covered=0;
    for(let i=1;i<navigationGeometry.length;i++){const length=lengths[i-1];if(covered+length<target){out.push(navigationGeometry[i]);covered+=length;continue;}const ratio=length>0?Math.max(0,Math.min(1,(target-covered)/length)):0,a=navigationGeometry[i-1],b=navigationGeometry[i];out.push([a[0]+(b[0]-a[0])*ratio,a[1]+(b[1]-a[1])*ratio]);break;}
    return out.length>=2?out:[];
  }

  function renderNavigationRoute() {
    if (!map || !mapLoaded || !map.addSource) return;
    const data = navigationGeometry.length ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: navigationGeometry } } : { type: "FeatureCollection", features: [] };
    const source = map.getSource?.(navigationSourceId);
    if (source) source.setData(data);
    else {
      map.addSource(navigationSourceId, { type: "geojson", data });
      map.addLayer?.({ id: "driver-navigation-route-casing", type: "line", source: navigationSourceId, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#10231e", "line-opacity": 0.8, "line-width": 8 } });
      map.addLayer?.({ id: "driver-navigation-route-line", type: "line", source: navigationSourceId, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2f8cff", "line-opacity": 0.95, "line-width": 5 } });
    }
    const progressGeometry=navigationProgressGeometry(),progressData=progressGeometry.length?{type:"Feature",properties:{progress:navigationProgress},geometry:{type:"LineString",coordinates:progressGeometry}}:{type:"FeatureCollection",features:[]};const progressSource=map.getSource?.(navigationProgressSourceId);if(progressSource)progressSource.setData(progressData);else{map.addSource(navigationProgressSourceId,{type:"geojson",data:progressData});map.addLayer?.({id:"driver-navigation-progress-line",type:"line",source:navigationProgressSourceId,layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#68e0ad","line-opacity":.98,"line-width":5.5}});}
  }

  function fitRoute() {
    if (!map || navigationGeometry.length < 2 || !map.fitBounds) return false;
    let minLon=180,maxLon=-180,minLat=90,maxLat=-90;
    for (const [lon,lat] of navigationGeometry) { minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat); }
    map.fitBounds([[minLon,minLat],[maxLon,maxLat]],{padding:48,maxZoom:14,duration:450});
    experience?.setFollowMode?.("FREE");
    return true;
  }

  async function showRoute(route,{fit=true}={}) {
    const alternative=route?.geometry?route:route?.selectedAlternative;
    const geometry=validNavigationGeometry(alternative?.geometry);
    if (!geometry.length) return false;
    if (!(await init())) return false;
    navigationGeometry=geometry;
    navigationProgress=0;
    renderNavigationRoute();
    if (fit) fitRoute();
    return true;
  }

  function clearRoute() {
    navigationGeometry=[];
    navigationProgress=0;
    if (map && mapLoaded) map.getSource?.(navigationSourceId)?.setData({type:"FeatureCollection",features:[]});
    if (map && mapLoaded) map.getSource?.(navigationProgressSourceId)?.setData({type:"FeatureCollection",features:[]});
  }

  function setRouteProgress(progress) {const next=Number(progress);if(!Number.isFinite(next))return false;navigationProgress=Math.max(0,Math.min(1,next));if(map&&mapLoaded)renderNavigationRoute();return true;}

  async function pickPoint() {
    if (!(await init()) || !map?.once) throw new Error("map_point_selection_unavailable");
    experience?.setFollowMode?.("FREE");
    const canvas=map.getCanvas?.();if(canvas)canvas.style.cursor="crosshair";
    return new Promise((resolve)=>map.once("click",(event)=>{if(canvas)canvas.style.cursor="";const longitude=Number(event?.lngLat?.lng),latitude=Number(event?.lngLat?.lat);resolve(Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude}:null);}));
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

  function focusOwn({ follow = false } = {}) {
    if (!map || !ownLocation) return false;
    if (follow) experience?.setFollowMode("FOLLOW");
    const currentZoom = map.getZoom?.();
    map.easeTo({ center: [ownLocation.longitude, ownLocation.latitude], zoom: Math.max(GPS_FOCUS_ZOOM, Number.isFinite(currentZoom) ? currentZoom : GPS_FOCUS_ZOOM), duration: 450 });
    return true;
  }

  function recenterOwn() { return focusOwn({ follow: true }); }

  function clearParkingPlace() {
    parkingMarker?.remove?.();
    parkingMarker = null;
    focusedParking = null;
  }

  async function showParkingPlace(place) {
    const latitude = Number(place?.latitude), longitude = Number(place?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    if (!(await init())) return false;
    clearParkingPlace();
    focusedParking = { ...place, latitude, longitude };
    const element = parkingMarkerElement(focusedParking);
    element.addEventListener("click", () => map?.easeTo?.({ center: [longitude, latitude], zoom: Math.max(PARKING_FOCUS_ZOOM, map?.getZoom?.() || PARKING_FOCUS_ZOOM), duration: 300 }));
    parkingMarker = new window.maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(map);
    experience?.setFollowMode?.("FREE");
    map.easeTo?.({ center: [longitude, latitude], zoom: PARKING_FOCUS_ZOOM, duration: 450 });
    return true;
  }

  function createLocationControl() {
    return { onAdd() { const container = document.createElement("div"); container.className = "maplibregl-ctrl maplibregl-ctrl-group driver-location-control"; locationButton = document.createElement("button"); locationButton.id = "map-locate"; locationButton.type = "button"; locationButton.setAttribute("aria-label", "Вернуться к моему местоположению и следить"); locationButton.textContent = "⌖"; locationButton.addEventListener("click", recenterOwn); container.append(locationButton); updateLocationControl(); return container; }, onRemove() { locationButton = null; } };
  }

  function removeNearbyMarkers() { for (const marker of nearbyMarkers.values()) marker.remove(); nearbyMarkers.clear(); }

  function renderNearbyMarkers() {
    if (!map || experience?.isLayerVisible("drivers") === false) { removeNearbyMarkers(); return; }
    const items = clusterNearbyDrivers(nearbyDrivers, map.getZoom?.() || config.zoom);
    const visible = new Set();
    for (const item of items) {
      visible.add(item.key);
      let marker = nearbyMarkers.get(item.key);
      if (!marker) {
        if (item.kind === "cluster") {
          const element = document.createElement("button"); element.type = "button"; element.className = "driver-map-cluster"; element.textContent = String(item.count); element.setAttribute("aria-label", `${item.count} водителей рядом. Приблизить карту.`); element.addEventListener("click", () => map.easeTo?.({ center: [item.longitude, item.latitude], zoom: Math.min(config.maxZoom, (map.getZoom?.() || 8) + 2), duration: 350 })); marker = new window.maplibregl.Marker({ element }).setLngLat([item.longitude, item.latitude]).addTo(map);
        } else {
          const element = driverMarkerElement(item.driver); element.addEventListener("click", () => Promise.resolve(onDriverCard?.(item.driver.nickname)).catch(() => {})); marker = new window.maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([item.driver.longitude, item.driver.latitude]).addTo(map);
        }
        nearbyMarkers.set(item.key, marker);
      } else if (item.kind === "cluster") marker.setLngLat([item.longitude, item.latitude]); else marker.setLngLat([item.driver.longitude, item.driver.latitude]);
    }
    for (const [key, marker] of nearbyMarkers) if (!visible.has(key)) { marker.remove(); nearbyMarkers.delete(key); }
  }

  function handleLayerChange(key, visible) { if (key === "roadReports") roadReports?.setVisible?.(visible); if (key === "drivers") renderNearbyMarkers(); if (key === "searchRadius") updateRadiusOverlay(); }
  function applyAutoRadius(nextRadius) { if (![5, 25, 50, 100].includes(nextRadius)) return; setRadius(nextRadius, { focus: false }); document.querySelector("#driver-map")?.dispatchEvent(new CustomEvent("patap:map-radius", { detail: { radius: nextRadius } })); }

  async function init() {
    if (map) return true;
    try { await ensureMapLibre(); } catch { setState("Не удалось загрузить карту. Чат, контакты и профиль продолжают работать.", "error"); return false; }
    try {
      const configuredZoom = Number.isFinite(config.zoom) ? config.zoom : INITIAL_MAP_ZOOM;
      map = new window.maplibregl.Map({ container: "driver-map", center: config.center, zoom: Math.max(INITIAL_MAP_ZOOM, configuredZoom), maxZoom: config.maxZoom, attributionControl: false, style: { version: 8, sources: { basemap: { type: "raster", tiles: config.tiles, tileSize: 256, maxzoom: config.maxZoom, attribution: config.attribution } }, layers: [{ id: "basemap", type: "raster", source: "basemap" }] } });
      map.addControl(new window.maplibregl.AttributionControl({ compact: false, customAttribution: config.attribution }));
      map.addControl(createLocationControl(), "top-right");
      if (map.on) map.on("load", () => { mapLoaded = true; updateRadiusOverlay(); renderNavigationRoute(); experience?.setOwnLocation(ownLocation); }); else { mapLoaded = true; renderNavigationRoute(); }
      if (globalThis.ResizeObserver) { resizeObserver = new ResizeObserver(() => map?.resize()); resizeObserver.observe(document.querySelector("#driver-map")); }
      const mapElement = document.querySelector("#driver-map");
      experience = createMapExperience({ map, mapElement, getOwnLocation: () => ownLocation ? { ...ownLocation } : null, onLayerChange: handleLayerChange, onAutoRadius: applyAutoRadius });
      roadReports = createRoadReportPanel({ map, mapElement, api, getOwnLocation: () => ownLocation ? { ...ownLocation } : null, isProfileReady: () => profileReady, onAuthLost, showError, onReportsChanged: (reports) => experience?.setReports(reports), isVisible: () => experience?.isLayerVisible("roadReports") !== false });
      roadReports.setVisible?.(experience.isLayerVisible("roadReports"));
      map.on?.("zoomend", renderNearbyMarkers);
      return true;
    } catch { map = null; setState("Не удалось запустить интерактивную карту. Профиль и чат остаются доступны.", "error"); return false; }
  }

  function clearOwn() { if (ownMarker) ownMarker.remove(); ownMarker = null; ownLocation = null; initialGpsFocused = false; clearRadiusOverlay(); experience?.clearOwnLocation(); updateLocationControl(); }

  function showOwn(location) {
    if (!map) return;
    ownLocation = { longitude: location.longitude, latitude: location.latitude, accuracy: location.accuracy, heading: typeof location.heading === "number" ? location.heading : null, speed: typeof location.speed === "number" ? location.speed : null, timestamp: typeof location.timestamp === "number" ? location.timestamp : Date.now() };
    const point = [location.longitude, location.latitude];
    if (!ownMarker) ownMarker = new window.maplibregl.Marker({ color: "#2f8cff" }).setLngLat(point).addTo(map); else ownMarker.setLngLat(point);
    updateLocationControl(); updateRadiusOverlay(); experience?.setOwnLocation(ownLocation);
    if (!initialGpsFocused) { initialGpsFocused = true; focusOwn(); }
  }

  function setRadius(nextRadius, { focus = false } = {}) { if (!Number.isFinite(nextRadius) || nextRadius <= 0) return false; radiusKm = nextRadius; updateRadiusOverlay(); if (focus && map && ownLocation) { map.easeTo({ center: [ownLocation.longitude, ownLocation.latitude], zoom: radiusZoom(ownLocation, radiusKm), duration: 450 }); return true; } return false; }
  function showNearby(drivers) { nearbyDrivers = Array.isArray(drivers) ? drivers.slice() : []; experience?.setDrivers(nearbyDrivers); renderNearbyMarkers(); }
  function clearNearby() { nearbyDrivers = []; experience?.setDrivers([]); removeNearbyMarkers(); }
  function setProfileReady(value) { profileReady = Boolean(value); }
  function getOwnLocation() { return ownLocation ? { ...ownLocation } : null; }

  return { init, resize() { if (map) map.resize(); }, isReady() { return Boolean(map); }, showOwn, setRadius, recenterOwn, clearOwn, showNearby, clearNearby, showParkingPlace, clearParkingPlace, showRoute, clearRoute, setRouteProgress, fitRoute, pickPoint, getOwnLocation, refreshRoadReports() { return roadReports?.refresh?.(); }, setProfileReady, getMapExperienceState() { return experience?.getState?.() || null; }, getFocusedParking() { return focusedParking; } };
}

export function createDriverModule(context) {
  const controller = createMapController({ api: context.api, onAuthLost: context.onAuthLost, showError: context.showError, setState(text, state) { context.getModule("gps")?.controller?.setState(text, state); }, onDriverCard(nickname) { return context.openDriverCard?.(nickname); } });
  return { controller, async activate() { await controller.init(); await controller.refreshRoadReports(); window.setTimeout(() => controller.resize(), 0); }, setSession({ profile }) { controller.setProfileReady(Boolean(profile)); }, setProfileReady(profile) { controller.setProfileReady(Boolean(profile)); }, reset() { controller.setProfileReady(false); controller.clearParkingPlace(); controller.clearRoute(); } };
}
