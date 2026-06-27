// Knex configuration. A single source of truth shared by the app (src/db/knex.js)
// and the Knex CLI (migrate/seed). Picks PostgreSQL when DATABASE_URL is set,
// otherwise SQLite — so `npm run setup && npm start` works with zero config.
const fs = require('fs');
const path = require('path');
const config = require('./src/config');

const migrations = { directory: path.join(__dirname, 'src/db/migrations') };
const seeds = { directory: path.join(__dirname, 'src/db/seeds') };

let connectionConfig;

if (config.db.url) {
  // PostgreSQL (production)
  connectionConfig = {
    client: 'pg',
    connection: {
      connectionString: config.db.url,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
    },
    pool: { min: 0, max: 10 },
    migrations,
    seeds,
  };
} else {
  // SQLite (local / zero-config). Ensure the data/ folder exists.
  const dir = path.dirname(config.db.sqliteFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  connectionConfig = {
    client: 'better-sqlite3',
    connection: { filename: config.db.sqliteFile },
    useNullAsDefault: true,
    // Enforce foreign keys on SQLite (off by default per-connection).
    // better-sqlite3's pragma() is synchronous, so run it then signal done().
    pool: {
      afterCreate: (conn, done) => {
        try {
          conn.pragma('foreign_keys = ON');
          done(null, conn);
        } catch (err) {
          done(err, conn);
        }
      },
    },
    migrations,
    seeds,
  };
}

// Knex CLI expects a map keyed by environment; the app reads the resolved one.
module.exports = {
  development: connectionConfig,
  production: connectionConfig,
  test: connectionConfig,
  // convenience export used by src/db/knex.js
  resolved: connectionConfig,
};
