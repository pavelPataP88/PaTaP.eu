const NAVIGATION_SCHEMA_VERSION = 1;

function ensureNavigationSchema(db, now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS navigation_schema_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS navigation_vehicle_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      vehicle_class TEXT NOT NULL DEFAULT 'TRUCK' CHECK(vehicle_class IN ('TRUCK','VAN','CAR','TAXI','OTHER')),
      length_m REAL CHECK(length_m IS NULL OR (length_m >= 1 AND length_m <= 40)),
      width_m REAL CHECK(width_m IS NULL OR (width_m >= 1 AND width_m <= 6)),
      height_m REAL CHECK(height_m IS NULL OR (height_m >= 1 AND height_m <= 8)),
      gross_weight_t REAL CHECK(gross_weight_t IS NULL OR (gross_weight_t >= 0.5 AND gross_weight_t <= 100)),
      axle_load_t REAL CHECK(axle_load_t IS NULL OR (axle_load_t >= 0.5 AND axle_load_t <= 40)),
      axle_count INTEGER CHECK(axle_count IS NULL OR (axle_count >= 2 AND axle_count <= 20)),
      max_speed_kph INTEGER CHECK(max_speed_kph IS NULL OR (max_speed_kph >= 20 AND max_speed_kph <= 180)),
      trailer INTEGER NOT NULL DEFAULT 0 CHECK(trailer IN (0,1)),
      hazardous_goods INTEGER NOT NULL DEFAULT 0 CHECK(hazardous_goods IN (0,1)),
      hazmat_categories_json TEXT NOT NULL DEFAULT '[]',
      adr_tunnel_code TEXT NOT NULL DEFAULT 'NONE' CHECK(adr_tunnel_code IN ('NONE','A','B','C','D','E')),
      refrigerated INTEGER NOT NULL DEFAULT 0 CHECK(refrigerated IN (0,1)),
      emission_class TEXT NOT NULL DEFAULT '' CHECK(length(emission_class) <= 40),
      co2_class TEXT NOT NULL DEFAULT '' CHECK(length(co2_class) <= 40),
      preferred_strategy TEXT NOT NULL DEFAULT 'PRACTICAL_TRUCK' CHECK(preferred_strategy IN ('FASTEST_LEGAL','PRACTICAL_TRUCK','EASY_TRUCK','ECONOMY','PARKING_AWARE')),
      avoid_tolls INTEGER NOT NULL DEFAULT 0 CHECK(avoid_tolls IN (0,1)),
      avoid_ferries INTEGER NOT NULL DEFAULT 0 CHECK(avoid_ferries IN (0,1)),
      avoid_unpaved INTEGER NOT NULL DEFAULT 1 CHECK(avoid_unpaved IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS navigation_routes (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 16 AND 80),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','CANCELLED','EXPIRED')),
      provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),
      provider_version TEXT NOT NULL DEFAULT '' CHECK(length(provider_version) <= 80),
      strategy TEXT NOT NULL CHECK(strategy IN ('FASTEST_LEGAL','PRACTICAL_TRUCK','EASY_TRUCK','ECONOMY','PARKING_AWARE')),
      vehicle_snapshot_json TEXT NOT NULL,
      request_json TEXT NOT NULL,
      alternatives_json TEXT NOT NULL,
      selected_alternative_id TEXT NOT NULL CHECK(length(selected_alternative_id) BETWEEN 1 AND 80),
      route_guard_json TEXT NOT NULL,
      enrichment_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS navigation_routes_user_state_idx
      ON navigation_routes(user_id,status,updated_at DESC);
    CREATE INDEX IF NOT EXISTS navigation_routes_expiry_idx
      ON navigation_routes(expires_at,status);

    CREATE TRIGGER IF NOT EXISTS navigation_routes_one_active_insert
    BEFORE INSERT ON navigation_routes
    WHEN NEW.status='ACTIVE'
    BEGIN
      UPDATE navigation_routes
      SET status='CANCELLED', updated_at=NEW.created_at
      WHERE user_id=NEW.user_id AND status='ACTIVE';
    END;

    CREATE TRIGGER IF NOT EXISTS navigation_routes_history_retention
    AFTER INSERT ON navigation_routes
    BEGIN
      DELETE FROM navigation_routes
      WHERE user_id=NEW.user_id
        AND status!='ACTIVE'
        AND julianday(updated_at) < julianday(NEW.created_at, '-30 days');
    END;
  `);

  db.prepare(`INSERT INTO navigation_schema_meta(singleton,version,updated_at) VALUES(1,?,?)
    ON CONFLICT(singleton) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`)
    .run(NAVIGATION_SCHEMA_VERSION, now);

  return { version: NAVIGATION_SCHEMA_VERSION };
}

module.exports = { NAVIGATION_SCHEMA_VERSION, ensureNavigationSchema };
