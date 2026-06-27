// Central configuration, read once from the environment.
require('dotenv').config();

const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const config = {
  env: NODE_ENV,
  isProd,
  port: Number(process.env.PORT || 4000),

  corsOrigin: (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  db: {
    // When DATABASE_URL is present we run on PostgreSQL (production); otherwise
    // SQLite is used so the project runs with zero configuration after clone.
    url: process.env.DATABASE_URL || null,
    ssl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true',
    sqliteFile: path.resolve(
      process.cwd(),
      process.env.SQLITE_FILE || './data/p4.sqlite'
    ),
  },

  seedPassword: process.env.SEED_PASSWORD || 'metodop4',
};

// Fail fast in production if the JWT secret was left at the insecure default.
if (isProd && config.jwt.secret === 'dev-insecure-secret-change-me') {
  // eslint-disable-next-line no-console
  console.error('[config] JWT_SECRET inseguro em produção. Defina JWT_SECRET.');
  process.exit(1);
}

module.exports = config;
