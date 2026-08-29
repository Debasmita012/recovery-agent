const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let pool;

if (process.env.DATABASE_URL) {
  const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false }
  });
} else {
  try {
    const { newDb } = require('pg-mem');
    const db = newDb();
    const pgAdapter = db.adapters.createPg();
    pool = new pgAdapter.Pool();
    console.log('[db] No DATABASE_URL found. Initialized in-memory PostgreSQL engine (pg-mem).');
  } catch (err) {
    console.warn('[db] pg-mem fallback failed, defaulting to local pg.Pool');
    pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/recovery_agent' });
  }
}

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  try {
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS ruled_out_json TEXT;');
    await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS intervention_cost INTEGER DEFAULT 0;');
  } catch (_) {}
  console.log('Schema ready.');
}

module.exports = { pool, initSchema };
