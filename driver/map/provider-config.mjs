const REQUIRED_TOKENS = Object.freeze(["{z}", "{x}", "{y}"]);
const MODES = new Set(["PUBLIC_OSM_FALLBACK", "CUSTOM", "SELF_HOSTED"]);

function configError(message) {
  const error = new Error(message);
  error.code = "map_provider_invalid";
  return error;
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validTileTemplate(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) return false;
  if (!REQUIRED_TOKENS.every((token) => value.includes(token))) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return validHttpsUrl(value);
}

export function validateMapProvider(input) {
  if (!input || input.version !== 1 || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(input.id)) {
    throw configError("invalid_map_provider_identity");
  }
  if (!MODES.has(input.mode)) throw configError("invalid_map_provider_mode");
  if (!Array.isArray(input.tiles) || input.tiles.length < 1 || input.tiles.length > 4 || input.tiles.some((tile) => !validTileTemplate(tile))) {
    throw configError("invalid_map_provider_tiles");
  }
  const tileSize = Number(input.tileSize ?? 256);
  if (![256, 512].includes(tileSize)) throw configError("invalid_map_provider_tile_size");
  const maxZoom = Number(input.maxZoom);
  if (!Number.isInteger(maxZoom) || maxZoom < 1 || maxZoom > 24) throw configError("invalid_map_provider_zoom");
  if (typeof input.attribution !== "string" || !input.attribution.trim() || input.attribution.length > 500) {
    throw configError("invalid_map_provider_attribution");
  }
  const reportIssueUrl = input.reportIssueUrl == null ? null : String(input.reportIssueUrl);
  if (reportIssueUrl && !validHttpsUrl(reportIssueUrl)) throw configError("invalid_map_provider_issue_url");
  return Object.freeze({
    version: 1,
    id: input.id,
    mode: input.mode,
    tiles: Object.freeze(input.tiles.slice()),
    tileSize,
    maxZoom,
    attribution: input.attribution.trim(),
    reportIssueUrl
  });
}

export function mergeMapProvider(baseConfig, providerInput) {
  const provider = validateMapProvider(providerInput);
  const base = baseConfig && typeof baseConfig === "object" ? { ...baseConfig } : {};
  delete base.tiles;
  delete base.attribution;
  delete base.tileSize;
  delete base.mapProvider;
  const baseMaxZoom = Number(base.maxZoom);
  return {
    ...base,
    maxZoom: Number.isFinite(baseMaxZoom) ? Math.min(baseMaxZoom, provider.maxZoom) : provider.maxZoom,
    tiles: provider.tiles.slice(),
    tileSize: provider.tileSize,
    attribution: provider.attribution,
    mapProvider: {
      id: provider.id,
      mode: provider.mode,
      reportIssueUrl: provider.reportIssueUrl
    }
  };
}
