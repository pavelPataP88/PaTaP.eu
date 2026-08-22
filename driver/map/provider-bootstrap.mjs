import { mergeMapProvider, validateMapProvider } from "./provider-config.mjs?v=20260822-aud023-1";
import { createDriverModule as createBaseMapModule } from "./index.js?v=20260819-parking1";

const PROVIDER_URL = "/map-provider.json?v=20260822-aud023-1";
const configElement = document.querySelector("#driver-map-config");

function readBaseConfig() {
  if (!configElement) throw new Error("driver_map_config_missing");
  const parsed = JSON.parse(configElement.textContent || "{}");
  // The application must not silently keep using an embedded tile provider if
  // the external provider config is missing or invalid.
  delete parsed.tiles;
  delete parsed.attribution;
  delete parsed.tileSize;
  delete parsed.mapProvider;
  configElement.textContent = JSON.stringify(parsed);
  return parsed;
}

function updateProviderNote(provider) {
  const note = document.querySelector(".map-attribution");
  if (!note) return;
  note.replaceChildren();
  const label = document.createElement("span");
  label.textContent = `Источник карты: ${provider.id}. Атрибуция указана на карте.`;
  note.append(label);
  if (provider.reportIssueUrl) {
    note.append(document.createTextNode(" "));
    const link = document.createElement("a");
    link.href = provider.reportIssueUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Сообщить об ошибке карты";
    note.append(link);
  }
}

async function loadAndApplyProvider() {
  const baseConfig = readBaseConfig();
  const response = await fetch(PROVIDER_URL, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("map_provider_unavailable");
  const provider = validateMapProvider(await response.json());
  configElement.textContent = JSON.stringify(mergeMapProvider(baseConfig, provider));
  updateProviderNote(provider);
  return provider;
}

const providerReady = loadAndApplyProvider();

export async function createDriverModule(context) {
  await providerReady;
  return createBaseMapModule(context);
}
