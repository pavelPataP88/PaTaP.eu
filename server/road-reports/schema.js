const ROAD_REPORT_SCHEMA_VERSION = 1;

function ensureRoadReportSchema(db, now = new Date().toISOString()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS road_report_schema_meta (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS road_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL CHECK(type IN ('ACCIDENT','ROADWORK','OBSTACLE','ROAD_CONTROL','TRANSPORT_INSPECTION')),
        lane TEXT CHECK(lane IS NULL OR lane IN ('ALL','LEFT','MIDDLE','RIGHT','SHOULDER')),
        latitude REAL NOT NULL CHECK(latitude >= -90 AND latitude <= 90),
        longitude REAL NOT NULL CHECK(longitude >= -180 AND longitude <= 180),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        closed_at TEXT,
        CHECK(type IN ('ACCIDENT','ROADWORK') OR lane IS NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_road_reports_active ON road_reports(closed_at, expires_at, id DESC);
      CREATE INDEX IF NOT EXISTS idx_road_reports_author ON road_reports(author_id, id DESC);

      CREATE TABLE IF NOT EXISTS road_report_votes (
        report_id INTEGER NOT NULL REFERENCES road_reports(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','GONE')),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(report_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_road_report_votes_status ON road_report_votes(report_id, status);
    `);

    const current = db.prepare("SELECT version FROM road_report_schema_meta WHERE singleton = 1").get();
    if (!current) {
      db.prepare("INSERT INTO road_report_schema_meta(singleton, version, updated_at) VALUES(1, ?, ?)")
        .run(ROAD_REPORT_SCHEMA_VERSION, now);
    } else if (Number(current.version) < ROAD_REPORT_SCHEMA_VERSION) {
      db.prepare("UPDATE road_report_schema_meta SET version = ?, updated_at = ? WHERE singleton = 1")
        .run(ROAD_REPORT_SCHEMA_VERSION, now);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

module.exports = { ROAD_REPORT_SCHEMA_VERSION, ensureRoadReportSchema };
