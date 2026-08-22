const LOCATION_PRECISION = Object.freeze({
  NONE: "NONE",
  PUBLIC_APPROXIMATE: "PUBLIC_APPROXIMATE",
  CONTACT_APPROXIMATE: "CONTACT_APPROXIMATE",
  PRECISE: "PRECISE"
});

const APPROXIMATION = Object.freeze({
  PUBLIC_APPROXIMATE: Object.freeze({ gridDegrees: 0.02, accuracyFloorM: 1600 }),
  CONTACT_APPROXIMATE: Object.freeze({ gridDegrees: 0.005, accuracyFloorM: 400 })
});

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function quantize(value, step, min, max) {
  const rounded = Math.round(value / step) * step;
  return Number(Math.max(min, Math.min(max, rounded)).toFixed(6));
}

function discloseLocation(location, precision) {
  const latitude = finiteCoordinate(location?.latitude, -90, 90);
  const longitude = finiteCoordinate(location?.longitude, -180, 180);
  const rawAccuracy = Math.max(0, Number(location?.accuracy ?? location?.accuracy_m) || 0);
  if (latitude === null || longitude === null || precision === LOCATION_PRECISION.NONE) return null;

  if (precision === LOCATION_PRECISION.PRECISE) {
    return { latitude, longitude, accuracy: rawAccuracy, locationPrecision: LOCATION_PRECISION.PRECISE };
  }

  const config = APPROXIMATION[precision];
  if (!config) return null;
  return {
    latitude: quantize(latitude, config.gridDegrees, -90, 90),
    longitude: quantize(longitude, config.gridDegrees, -180, 180),
    accuracy: Math.max(rawAccuracy, config.accuracyFloorM),
    locationPrecision: precision
  };
}

module.exports = { LOCATION_PRECISION, APPROXIMATION, discloseLocation };
