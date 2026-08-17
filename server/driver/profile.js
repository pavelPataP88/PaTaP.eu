const DRIVER_TYPES = new Set(["TIR", "TAXI", "DELIVERY", "GENERAL"]);
const { normalizeCountryCode } = require("./countries");

function cleanOptionalText(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().normalize("NFKC");
  if (!text) return null;
  if (Array.from(text).length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) return undefined;
  return text;
}

function normalizeDriverProfile(body) {
  const nickname = cleanOptionalText(body.nickname, 32);
  const driverType = String(body.driverType || "").trim().toUpperCase();
  if (!nickname || nickname === undefined || Array.from(nickname).length < 3 ||
      !/^[\p{L}\p{N}][\p{L}\p{N}_-]{2,31}$/u.test(nickname) || !DRIVER_TYPES.has(driverType)) {
    return null;
  }
  const optional = {
    realName: cleanOptionalText(body.realName, 80),
    vehicle: cleanOptionalText(body.vehicle, 80),
    countryCode: normalizeCountryCode(body.countryCode)
  };
  if (Object.values(optional).includes(undefined)) return null;
  return {
    nickname,
    nicknameKey: nickname.toLocaleLowerCase("und"),
    driverType,
    ...optional
  };
}

function publicDriverProfile(row) {
  if (!row) return null;
  return {
    nickname: row.nickname,
    driverType: row.driver_type,
    realName: row.real_name,
    vehicle: row.vehicle,
    countryCode: row.country_code,
    gpsEnabled: row.gps_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createProfileRepository(db) {
  return {
    get(userId) {
      return db.prepare("SELECT * FROM driver_profiles WHERE user_id = ?").get(userId);
    },
    exists(userId) {
      return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id = ?").get(userId));
    },
    isGpsEnabled(userId) {
      return db.prepare("SELECT gps_enabled FROM driver_profiles WHERE user_id = ?").get(userId)?.gps_enabled === 1;
    },
    setGpsEnabled(userId, enabled, now) {
      return db.prepare("UPDATE driver_profiles SET gps_enabled = ?, updated_at = ? WHERE user_id = ?")
        .run(enabled ? 1 : 0, now, userId).changes;
    },
    save(userId, profile, now) {
      db.prepare(`
        INSERT INTO driver_profiles(
          user_id, nickname, nickname_key, driver_type, real_name, vehicle, country_code, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          nickname = excluded.nickname,
          nickname_key = excluded.nickname_key,
          driver_type = excluded.driver_type,
          real_name = excluded.real_name,
          vehicle = excluded.vehicle,
          country_code = excluded.country_code,
          updated_at = excluded.updated_at
      `).run(
        userId, profile.nickname, profile.nicknameKey, profile.driverType,
        profile.realName, profile.vehicle, profile.countryCode, now, now
      );
      return this.get(userId);
    }
  };
}

module.exports = { DRIVER_TYPES, normalizeDriverProfile, publicDriverProfile, createProfileRepository };
