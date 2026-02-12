const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tenant_manager.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function initDb() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await db.exec(schema);

  return db;
}

module.exports = {
  initDb,
  DB_PATH
};
