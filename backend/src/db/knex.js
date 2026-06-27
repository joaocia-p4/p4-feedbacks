// Single shared Knex instance for the application.
const knex = require('knex');
const knexfile = require('../../knexfile');

const db = knex(knexfile.resolved);

// Small helper so services can branch on the active dialect when needed.
db.isSqlite = knexfile.resolved.client === 'better-sqlite3';
db.isPg = knexfile.resolved.client === 'pg';

module.exports = db;
