const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
(async () => {
  const db = await open({ filename: 'data/tenant_manager.sqlite', driver: sqlite3.Database });
  const rows = await db.all('SELECT id, firstName, lastName, apartmentNumber, phone, startDate, endDate, moveOutDate, archived, active FROM tenants ORDER BY id DESC LIMIT 30');
  console.log(JSON.stringify(rows, null, 2));
  await db.close();
})().catch(err => { console.error(err); process.exit(1); });
