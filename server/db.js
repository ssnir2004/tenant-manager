const path = require('path');
const fs = require('fs');
let Pool;

try {
  ({ Pool } = require('pg'));
} catch (err) {
  Pool = null;
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tenant_manager.sqlite');
const SQLITE_SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const POSTGRES_SCHEMA_PATH = path.join(__dirname, 'schema_postgres.sql');
const RETURNING_TABLES = new Set([
  'tenants',
  'readings',
  'users',
  'bills',
  'payments',
  'expenses',
  'solar'
]);

function isPostgresEnabled() {
  return !!process.env.DATABASE_URL;
}

function buildPostgresConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const useSsl = /sslmode=require/i.test(connectionString) || process.env.PGSSL === 'true';
  return {
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  };
}

const POSTGRES_CAMEL_CASE_IDENTIFIERS = [
  'firstName',
  'lastName',
  'nationalId',
  'startDate',
  'endDate',
  'moveOutDate',
  'rentAmount',
  'rentHistory',
  'arnonaAmount',
  'arnonaHistory',
  'depositDay',
  'apartmentNumber',
  'electricityMeter',
  'waterMeter',
  'createdAt',
  'tenantId',
  'meterType',
  'submittedByUserId',
  'approvedByUserId',
  'approvedAt',
  'passwordHash',
  'canWrite',
  'canSubmitReadings',
  'isActive',
  'userId'
];

function normalizePostgresIdentifiers(sql) {
  let normalized = sql;
  for (const identifier of POSTGRES_CAMEL_CASE_IDENTIFIERS) {
    const pattern = new RegExp(`(?<!")\\b${identifier}\\b(?!")`, 'g');
    normalized = normalized.replace(pattern, `"${identifier}"`);
  }
  return normalized;
}

function normalizePostgresSql(sql) {
  const sqlWithIdentifiers = normalizePostgresIdentifiers(sql);
  let index = 0;
  return sqlWithIdentifiers.replace(/\?/g, () => `$${++index}`);
}

async function execSchema(db, schema) {
  const statements = schema
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.exec(statement);
  }
}

function wrapPostgres(pool) {
  return {
    isPostgres: true,
    async exec(sql, params = []) {
      return pool.query(normalizePostgresSql(sql), params);
    },
    async get(sql, params = []) {
      const result = await pool.query(normalizePostgresSql(sql), params);
      return result.rows[0] || null;
    },
    async all(sql, params = []) {
      const result = await pool.query(normalizePostgresSql(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      let text = normalizePostgresSql(sql);
      let shouldReturnId = false;
      const insertMatch = /^\s*insert\s+into\s+(\w+)/i.exec(text);
      if (insertMatch && !/\breturning\b/i.test(text)) {
        const tableName = insertMatch[1].toLowerCase();
        shouldReturnId = RETURNING_TABLES.has(tableName);
        if (shouldReturnId) {
          text += ' RETURNING id';
        }
      }

      const result = await pool.query(text, params);
      const lastID = shouldReturnId && result.rows[0] ? result.rows[0].id : undefined;
      return { lastID, changes: result.rowCount || 0 };
    },
    async close() {
      await pool.end();
    }
  };
}

async function initDb() {
  if (isPostgresEnabled()) {
    if (!Pool) {
      throw new Error('Postgres is enabled but the pg package is not installed.');
    }

    const config = buildPostgresConfig();
    const pool = new Pool(config);
    const db = wrapPostgres(pool);

    const schema = fs.readFileSync(POSTGRES_SCHEMA_PATH, 'utf8');
    await execSchema(db, schema);
    await migrateSchema(db);
    return db;
  }

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let sqlite3;
  let open;
  try {
    sqlite3 = require('sqlite3');
    ({ open } = require('sqlite'));
  } catch (err) {
    throw new Error('SQLite mode requires sqlite and sqlite3 packages. Install dependencies before running without DATABASE_URL.');
  }

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  const schema = fs.readFileSync(SQLITE_SCHEMA_PATH, 'utf8');
  await db.exec(schema);
  await migrateSchema(db);
  return db;
}

async function migrateSchema(db) {
  const tenantsColumns = await getTableColumns(db, 'tenants');
  await ensureColumn(db, 'tenants', 'depositDay', 'TEXT', tenantsColumns);
  await ensureColumn(db, 'tenants', 'rentHistory', 'TEXT', tenantsColumns);
  await ensureColumn(db, 'tenants', 'arnonaHistory', 'TEXT', tenantsColumns);

  const readingsColumns = await getTableColumns(db, 'readings');
  await ensureColumn(db, 'readings', 'status', "TEXT DEFAULT 'approved'", readingsColumns);
  await ensureColumn(db, 'readings', 'submittedByUserId', 'INTEGER', readingsColumns);
  await ensureColumn(db, 'readings', 'approvedByUserId', 'INTEGER', readingsColumns);
  await ensureColumn(db, 'readings', 'approvedAt', 'TEXT', readingsColumns);
  await ensureColumn(db, 'readings', 'paid', 'INTEGER DEFAULT 0', readingsColumns);
  await ensureColumn(db, 'readings', 'notes', 'TEXT', readingsColumns);

  const expensesColumns = await getTableColumns(db, 'expenses');
  await ensureColumn(db, 'expenses', 'paid', 'INTEGER DEFAULT 0', expensesColumns);
}

async function getTableColumns(db, tableName) {
  if (db.isPostgres) {
    const rows = await db.all(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
      [tableName]
    );
    return new Set(rows.map(row => row.column_name));
  }

  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  return new Set(rows.map(row => row.name));
}

async function ensureColumn(db, tableName, columnName, columnDef, existingColumns) {
  if (existingColumns.has(columnName)) return;
  if (db.isPostgres) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${columnDef}`);
    return;
  }
  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
}

module.exports = {
  initDb,
  DB_PATH
};
