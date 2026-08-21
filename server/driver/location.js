const { createPeoplePrivacy } = require("../people/privacy");
const { LOCATION_PRECISION, discloseLocation } = require("../people/location-disclosure");

const DRIVER_RADII_KM = new Set([5, 25, 50, 100]);

function validLocation(body) {
  const { latitude, longitude, accuracy } = body;
  if (typeof latitude !== "number" || typeof longitude !== "number" || typeof accuracy !== "number") return null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000) return null;
  return { latitude, longitude, accuracy };
}

function haversineKm(fromLat, fromLon, toLat, toLon) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371.0088;
  const latDelta = radians(toLat - fromLat);
  const lonDelta = radians(toLon - fromLon);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(lonDelta / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createLocationRepository(db, { addMinutes, nowIso = () => new Date().toISOString() }) {
  const privacy = createPeoplePrivacy(db, { nowIso });
  return {
    exists(userId) {
      return Boolean(db.prepare("SELECT 1 FROM driver_locations WHERE user_id = ?").get(userId));
    },
    save(userId, location, updatedAt) {
      db.prepare(`
        INSERT INTO driver_locations(user_id, latitude, longitude, accuracy_m, updated_at)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          accuracy_m = excluded.accuracy_m,
          updated_at = excluded.updated_at
      `).run(userId, location.latitude, location.longitude, location.accuracy, updatedAt);
    },
    remove(userId) {
      return db.prepare("DELETE FROM driver_locations WHERE user_id = ?").run(userId).changes;
    },
    getFresh(userId) {
      const row = db.prepare(`
        SELECT latitude, longitude, accuracy_m, updated_at
        FROM driver_locations WHERE user_id = ? AND updated_at >= ?
      `).get(userId, addMinutes(-1));
      return row ? {
        latitude: row.latitude,
        longitude: row.longitude,
        accuracy: row.accuracy_m,
        updatedAt: row.updated_at
      } : null;
    },
    nearbyDrivers(userId, origin, radius) {
      const rows = db.prepare(`
        SELECT l.user_id, l.latitude, l.longitude, l.accuracy_m, l.updated_at,
               p.nickname, p.driver_type, p.vehicle, p.country_code
        FROM driver_locations l
        JOIN driver_profiles p ON p.user_id = l.user_id
        JOIN users u ON u.id = l.user_id
        WHERE l.user_id != ? AND l.updated_at >= ? AND u.disabled = 0 AND p.gps_enabled = 1
          AND NOT EXISTS (
            SELECT 1 FROM driver_blocks b
            WHERE (b.blocker_id = ? AND b.blocked_id = l.user_id)
               OR (b.blocker_id = l.user_id AND b.blocked_id = ?)
          )
      `).all(userId, addMinutes(-1), userId, userId);

      return rows.map((row) => {
        const precision = privacy.nearbyPrecision(userId, Number(row.user_id));
        if (precision === LOCATION_PRECISION.NONE) return null;
        const actualDistanceKm = haversineKm(origin.latitude, origin.longitude, row.latitude, row.longitude);
        if (actualDistanceKm > radius) return null;
        const disclosed = discloseLocation({ latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy_m }, precision);
        if (!disclosed) return null;
        return {
          nickname: row.nickname,
          driverType: row.driver_type,
          vehicle: privacy.canSeeVehicle(userId, Number(row.user_id)) ? row.vehicle : null,
          countryCode: row.country_code,
          latitude: disclosed.latitude,
          longitude: disclosed.longitude,
          accuracy: disclosed.accuracy,
          updatedAt: row.updated_at,
          distanceKm: haversineKm(origin.latitude, origin.longitude, disclosed.latitude, disclosed.longitude)
        };
      }).filter(Boolean)
        .sort((left, right) => left.distanceKm - right.distanceKm)
        .map((driver) => ({ ...driver, distanceKm: Number(driver.distanceKm.toFixed(3)) }));
    }
  };
}

module.exports = { DRIVER_RADII_KM, validLocation, haversineKm, createLocationRepository };
