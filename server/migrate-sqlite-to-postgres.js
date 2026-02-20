const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { Pool } = require('pg');
require('dotenv').config();

const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tenant_manager.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema_postgres.sql');

function buildPostgresConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for Postgres migration.');
  }
  const useSsl = /sslmode=require/i.test(connectionString) || process.env.PGSSL === 'true';
  return {
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  };
}

async function execSchema(pool) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const statements = schema
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function migrateTable(pool, sqliteDb, tableName) {
  const rows = await sqliteDb.all(`SELECT * FROM ${tableName}`);
  if (!rows.length) return 0;

  const columns = Object.keys(rows[0]);
  const columnList = columns.map(col => `"${col}"`).join(', ');
  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

  for (const row of rows) {
    const values = columns.map(col => row[col]);
    const sql = `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    await pool.query(sql, values);
  }

  return rows.length;
}

async function updateSequence(pool, tableName) {
  const result = await pool.query(`SELECT MAX(id) AS max_id FROM ${tableName}`);
  const maxId = result.rows[0]?.max_id;
  if (!maxId) return;
  await pool.query(
    "SELECT setval(pg_get_serial_sequence($1, 'id'), $2)",
    [tableName, maxId]
  );
}

async function run() {
  const sqliteDb = await open({
    filename: SQLITE_PATH,
    driver: sqlite3.Database
  });

  const pool = new Pool(buildPostgresConfig());

  try {
    await execSchema(pool);

    const tables = [
      'tenants',
      'readings',
      'users',
      'user_tenants',
      'bills',
      'payments',
      'expenses',
      'solar',
      'settings'
    ];

    for (const table of tables) {
      const inserted = await migrateTable(pool, sqliteDb, table);
      if (['tenants', 'readings', 'users', 'bills', 'payments', 'expenses', 'solar'].includes(table)) {
        await updateSequence(pool, table);
      }
      console.log(`Migrated ${inserted} rows into ${table}`);
    }
  } finally {
    await sqliteDb.close();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
