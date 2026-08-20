const { createParkingRepository, SOURCE_AUTHORITY, haversineKm } = require("./repository");

const TRUE_ENRICHMENT_FIELDS = Object.freeze({
  access24h:"access_24h", access_24h:"access_24h",
  extraLongAllowed:"extra_long_allowed", extra_long_allowed:"extra_long_allowed",
  adrAllowed:"adr_allowed", adr_allowed:"adr_allowed",
  trailerDecoupling:"trailer_decoupling", trailer_decoupling:"trailer_decoupling",
  toilet:"toilet", shower:"shower", restaurant:"restaurant", shop:"shop", wifi:"wifi", laundry:"laundry", water:"water", accommodation:"accommodation", vending:"vending",
  diesel:"diesel", adblue:"adblue", lng:"lng", hydrogen:"hydrogen",
  evCharging:"ev_charging", ev_charging:"ev_charging",
  frigoPower:"frigo_power", frigo_power:"frigo_power",
  truckWash:"truck_wash", truck_wash:"truck_wash",
  truckRepair:"truck_repair", truck_repair:"truck_repair",
  restrictedAccess:"restricted_access", restricted_access:"restricted_access",
  cctv:"cctv", guard:"guard", fence:"fence", gate:"gate", lighting:"lighting",
  personalAccessControl:"personal_access_control", personal_access_control:"personal_access_control",
  reservable:"reservable"
});

function truthy(value) {
  return value === true || value === 1 || value === "1" || ["yes","true","designated","permissive","available","present"].includes(String(value || "").toLowerCase());
}

function applyTrueEnrichment(db, placeId, input) {
  const columns = new Set();
  for (const [key, column] of Object.entries(TRUE_ENRICHMENT_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key) && truthy(input[key])) columns.add(column);
  }
  if (!columns.size) return;
  db.prepare(`UPDATE parking_places SET ${[...columns].map((column) => `${column}=1`).join(",")} WHERE id=?`).run(Number(placeId));
}

function createParkingImportRepository(db, options = {}) {
  const base = createParkingRepository(db, options);
  return {
    ...base,
    upsertImportedPlace(input, source, now) {
      const result = base.upsertImportedPlace(input, source, now);
      if (!result?.error && result?.placeId) applyTrueEnrichment(db, result.placeId, input);
      return result;
    }
  };
}

module.exports = { createParkingImportRepository, applyTrueEnrichment, SOURCE_AUTHORITY, haversineKm };
