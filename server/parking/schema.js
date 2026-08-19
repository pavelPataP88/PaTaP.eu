const PARKING_SCHEMA_VERSION = 1;

function ensureParkingSchema(db, now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parking_schema_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parking_places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMMUNITY_UNVERIFIED','CLOSED','REMOVED')),
      kind TEXT NOT NULL DEFAULT 'TRUCK_PARKING' CHECK(kind IN ('TRUCK_PARKING','REST_AREA','SERVICE_AREA','MOP','SECURE_PARKING','YARD','OTHER')),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
      longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
      country_code TEXT CHECK(country_code IS NULL OR length(country_code) = 2),
      address TEXT NOT NULL DEFAULT '' CHECK(length(address) <= 300),
      road TEXT NOT NULL DEFAULT '' CHECK(length(road) <= 80),
      direction TEXT NOT NULL DEFAULT '' CHECK(length(direction) <= 80),
      operator TEXT NOT NULL DEFAULT '' CHECK(length(operator) <= 120),
      phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 80),
      website TEXT NOT NULL DEFAULT '' CHECK(length(website) <= 400),
      opening_hours TEXT NOT NULL DEFAULT '' CHECK(length(opening_hours) <= 200),
      capacity_truck INTEGER CHECK(capacity_truck IS NULL OR capacity_truck >= 0),
      capacity_total INTEGER CHECK(capacity_total IS NULL OR capacity_total >= 0),
      access_24h INTEGER NOT NULL DEFAULT 0 CHECK(access_24h IN (0,1)),
      fee_mode TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(fee_mode IN ('FREE','PAID','MIXED','UNKNOWN')),
      price_text TEXT NOT NULL DEFAULT '' CHECK(length(price_text) <= 160),
      currency TEXT NOT NULL DEFAULT '' CHECK(length(currency) <= 3),
      max_length_m REAL CHECK(max_length_m IS NULL OR max_length_m > 0),
      max_height_m REAL CHECK(max_height_m IS NULL OR max_height_m > 0),
      max_weight_t REAL CHECK(max_weight_t IS NULL OR max_weight_t > 0),
      extra_long_allowed INTEGER NOT NULL DEFAULT 0 CHECK(extra_long_allowed IN (0,1)),
      adr_allowed INTEGER NOT NULL DEFAULT 0 CHECK(adr_allowed IN (0,1)),
      trailer_decoupling INTEGER NOT NULL DEFAULT 0 CHECK(trailer_decoupling IN (0,1)),
      toilet INTEGER NOT NULL DEFAULT 0 CHECK(toilet IN (0,1)),
      shower INTEGER NOT NULL DEFAULT 0 CHECK(shower IN (0,1)),
      restaurant INTEGER NOT NULL DEFAULT 0 CHECK(restaurant IN (0,1)),
      shop INTEGER NOT NULL DEFAULT 0 CHECK(shop IN (0,1)),
      wifi INTEGER NOT NULL DEFAULT 0 CHECK(wifi IN (0,1)),
      laundry INTEGER NOT NULL DEFAULT 0 CHECK(laundry IN (0,1)),
      water INTEGER NOT NULL DEFAULT 0 CHECK(water IN (0,1)),
      accommodation INTEGER NOT NULL DEFAULT 0 CHECK(accommodation IN (0,1)),
      vending INTEGER NOT NULL DEFAULT 0 CHECK(vending IN (0,1)),
      diesel INTEGER NOT NULL DEFAULT 0 CHECK(diesel IN (0,1)),
      adblue INTEGER NOT NULL DEFAULT 0 CHECK(adblue IN (0,1)),
      lng INTEGER NOT NULL DEFAULT 0 CHECK(lng IN (0,1)),
      hydrogen INTEGER NOT NULL DEFAULT 0 CHECK(hydrogen IN (0,1)),
      ev_charging INTEGER NOT NULL DEFAULT 0 CHECK(ev_charging IN (0,1)),
      frigo_power INTEGER NOT NULL DEFAULT 0 CHECK(frigo_power IN (0,1)),
      truck_wash INTEGER NOT NULL DEFAULT 0 CHECK(truck_wash IN (0,1)),
      truck_repair INTEGER NOT NULL DEFAULT 0 CHECK(truck_repair IN (0,1)),
      restricted_access INTEGER NOT NULL DEFAULT 0 CHECK(restricted_access IN (0,1)),
      cctv INTEGER NOT NULL DEFAULT 0 CHECK(cctv IN (0,1)),
      guard INTEGER NOT NULL DEFAULT 0 CHECK(guard IN (0,1)),
      fence INTEGER NOT NULL DEFAULT 0 CHECK(fence IN (0,1)),
      gate INTEGER NOT NULL DEFAULT 0 CHECK(gate IN (0,1)),
      lighting INTEGER NOT NULL DEFAULT 0 CHECK(lighting IN (0,1)),
      personal_access_control INTEGER NOT NULL DEFAULT 0 CHECK(personal_access_control IN (0,1)),
      certification_level TEXT NOT NULL DEFAULT 'NONE' CHECK(certification_level IN ('NONE','BRONZE','SILVER','GOLD','PLATINUM')),
      certification_source TEXT NOT NULL DEFAULT '' CHECK(length(certification_source) <= 160),
      certification_valid_until TEXT,
      reservable INTEGER NOT NULL DEFAULT 0 CHECK(reservable IN (0,1)),
      booking_provider TEXT NOT NULL DEFAULT '' CHECK(length(booking_provider) <= 100),
      booking_url TEXT NOT NULL DEFAULT '' CHECK(length(booking_url) <= 500),
      booking_phone TEXT NOT NULL DEFAULT '' CHECK(length(booking_phone) <= 80),
      booking_instructions TEXT NOT NULL DEFAULT '' CHECK(length(booking_instructions) <= 500),
      data_confidence REAL NOT NULL DEFAULT 0.5 CHECK(data_confidence BETWEEN 0 AND 1),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS parking_place_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL REFERENCES parking_places(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('OFFICIAL_DATEX','OSM','OPERATOR','PATAP_COMMUNITY','MANUAL_ADMIN','OTHER')),
      external_id TEXT NOT NULL CHECK(length(external_id) BETWEEN 1 AND 180),
      authority INTEGER NOT NULL DEFAULT 50 CHECK(authority BETWEEN 0 AND 100),
      source_name TEXT NOT NULL DEFAULT '' CHECK(length(source_name) <= 160),
      source_url TEXT NOT NULL DEFAULT '' CHECK(length(source_url) <= 500),
      licence_text TEXT NOT NULL DEFAULT '' CHECK(length(licence_text) <= 300),
      source_updated_at TEXT,
      imported_at TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      raw_hash TEXT NOT NULL DEFAULT '',
      UNIQUE(source_type, external_id)
    );

    CREATE TABLE IF NOT EXISTS parking_occupancy_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL REFERENCES parking_places(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('OFFICIAL','DRIVER','OPERATOR','IMPORT')),
      source_key TEXT NOT NULL DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('AVAILABLE','LIMITED','FULL','CLOSED','UNKNOWN')),
      free_spots INTEGER CHECK(free_spots IS NULL OR free_spots >= 0),
      total_spots INTEGER CHECK(total_spots IS NULL OR total_spots >= 0),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 160),
      observed_at TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parking_reviews (
      place_id INTEGER NOT NULL REFERENCES parking_places(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 5),
      security INTEGER CHECK(security IS NULL OR security BETWEEN 1 AND 5),
      cleanliness INTEGER CHECK(cleanliness IS NULL OR cleanliness BETWEEN 1 AND 5),
      access_rating INTEGER CHECK(access_rating IS NULL OR access_rating BETWEEN 1 AND 5),
      quietness INTEGER CHECK(quietness IS NULL OR quietness BETWEEN 1 AND 5),
      text TEXT NOT NULL DEFAULT '' CHECK(length(text) <= 1200),
      visited_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(place_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS parking_favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      place_id INTEGER NOT NULL REFERENCES parking_places(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, place_id)
    );

    CREATE TABLE IF NOT EXISTS parking_user_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      vehicle_class TEXT NOT NULL DEFAULT 'TIR' CHECK(vehicle_class IN ('TIR','VAN','CAR','OTHER')),
      length_m REAL CHECK(length_m IS NULL OR length_m > 0),
      height_m REAL CHECK(height_m IS NULL OR height_m > 0),
      weight_t REAL CHECK(weight_t IS NULL OR weight_t > 0),
      adr_required INTEGER NOT NULL DEFAULT 0 CHECK(adr_required IN (0,1)),
      refrigerated INTEGER NOT NULL DEFAULT 0 CHECK(refrigerated IN (0,1)),
      secure_only INTEGER NOT NULL DEFAULT 0 CHECK(secure_only IN (0,1)),
      max_detour_km REAL NOT NULL DEFAULT 10 CHECK(max_detour_km BETWEEN 0.5 AND 100),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parking_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL REFERENCES parking_places(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK(kind IN ('WRONG_INFO','CLOSED','ACCESS','AMENITY','SECURITY','CAPACITY','LOCATION','OTHER')),
      message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 800),
      proposed_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','ACCEPTED','REJECTED','DUPLICATE')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS parking_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL REFERENCES parking_places(id) ON DELETE CASCADE,
      uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
      byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 5242880),
      file_name TEXT NOT NULL DEFAULT 'parking-photo' CHECK(length(file_name) <= 160),
      state TEXT NOT NULL DEFAULT 'VISIBLE' CHECK(state IN ('VISIBLE','HIDDEN','REMOVED')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parking_import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      records_seen INTEGER NOT NULL DEFAULT 0,
      places_created INTEGER NOT NULL DEFAULT 0,
      places_updated INTEGER NOT NULL DEFAULT 0,
      observations_added INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','COMPLETED','FAILED')),
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS parking_places_geo_idx ON parking_places(latitude, longitude, status);
    CREATE INDEX IF NOT EXISTS parking_places_country_idx ON parking_places(country_code, kind, status);
    CREATE INDEX IF NOT EXISTS parking_sources_place_idx ON parking_place_sources(place_id, authority DESC);
    CREATE INDEX IF NOT EXISTS parking_occupancy_place_time_idx ON parking_occupancy_observations(place_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS parking_reviews_place_idx ON parking_reviews(place_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS parking_corrections_state_idx ON parking_corrections(state, created_at DESC);
    CREATE INDEX IF NOT EXISTS parking_photos_place_idx ON parking_photos(place_id, state, created_at DESC);
  `);

  db.prepare(`INSERT INTO parking_schema_meta(singleton,version,updated_at) VALUES(1,?,?)
    ON CONFLICT(singleton) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`)
    .run(PARKING_SCHEMA_VERSION, now);
  return { version: PARKING_SCHEMA_VERSION };
}

module.exports = { PARKING_SCHEMA_VERSION, ensureParkingSchema };
