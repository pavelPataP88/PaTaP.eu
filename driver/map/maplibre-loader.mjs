export const MAPLIBRE_CSS_URL = "/vendor/maplibre/maplibre-gl.css?v=20260714-8";
export const MAPLIBRE_JS_URL = "/vendor/maplibre/maplibre-gl.js?v=20260714-8";

export function createMapLibreLoader({ documentRef, windowRef }) {
  let mapLibrePromise = null;

  function ensureCss() {
    let link = documentRef.querySelector('link[data-driver-maplibre-css="true"]');
    if (link?.dataset.maplibreReady === "true") return Promise.resolve();
    if (link?.mapLibreLoadPromise) return link.mapLibreLoadPromise;
    if (!link) {
      link = documentRef.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPLIBRE_CSS_URL;
      link.dataset.driverMaplibreCss = "true";
      documentRef.head.append(link);
    }
    link.mapLibreLoadPromise = new Promise((resolve, reject) => {
      link.addEventListener("load", () => {
        link.dataset.maplibreReady = "true";
        resolve();
      }, { once: true });
      link.addEventListener("error", () => {
        link.remove();
        reject(new Error("maplibre_css_load_failed"));
      }, { once: true });
    });
    return link.mapLibreLoadPromise;
  }

  function ensureScript() {
    if (windowRef.maplibregl) return Promise.resolve(windowRef.maplibregl);
    let script = documentRef.querySelector('script[data-driver-maplibre-js="true"]');
    if (script?.mapLibreLoadPromise) return script.mapLibreLoadPromise;
    if (!script) {
      script = documentRef.createElement("script");
      script.src = MAPLIBRE_JS_URL;
      script.defer = true;
      script.dataset.driverMaplibreJs = "true";
      documentRef.head.append(script);
    }
    script.mapLibreLoadPromise = new Promise((resolve, reject) => {
      script.addEventListener("load", () => {
        if (windowRef.maplibregl) resolve(windowRef.maplibregl);
        else {
          script.remove();
          reject(new Error("maplibre_unavailable"));
        }
      }, { once: true });
      script.addEventListener("error", () => {
        script.remove();
        reject(new Error("maplibre_load_failed"));
      }, { once: true });
    });
    return script.mapLibreLoadPromise;
  }

  return function ensureMapLibre() {
    if (mapLibrePromise) return mapLibrePromise;
    mapLibrePromise = Promise.all([ensureCss(), ensureScript()])
      .then(([, maplibregl]) => maplibregl)
      .catch((error) => {
        mapLibrePromise = null;
        throw error;
      });
    return mapLibrePromise;
  };
}

let defaultLoader = null;

export function ensureMapLibre() {
  if (!defaultLoader) defaultLoader = createMapLibreLoader({ documentRef: document, windowRef: window });
  return defaultLoader();
}
