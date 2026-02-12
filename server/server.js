const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const PORT = process.env.PORT || 3001;

function toBooleanInt(value) {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
}

(async () => {
  const db = await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  
  // Serve static files from parent directory (the app files)
  app.use(express.static(path.join(__dirname, '..')));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  // Tenants
  app.get('/api/tenants', async (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    const rows = includeArchived
      ? await db.all('SELECT * FROM tenants ORDER BY id DESC')
      : await db.all('SELECT * FROM tenants WHERE archived = 0 ORDER BY id DESC');
    res.json(rows);
  });

  app.get('/api/tenants/:id', async (req, res) => {
    const row = await db.get('SELECT * FROM tenants WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.post('/api/tenants', async (req, res) => {
    const t = req.body || {};
    const now = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO tenants (
        firstName, lastName, nationalId, phone, startDate, endDate, moveOutDate,
        rentAmount, arnonaAmount, apartmentNumber, electricityMeter, waterMeter,
        notes, createdAt, archived, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        t.firstName || '',
        t.lastName || '',
        t.nationalId || '',
        t.phone || '',
        t.startDate || '',
        t.endDate || '',
        t.moveOutDate || '',
        t.rentAmount ?? null,
        t.arnonaAmount ?? null,
        t.apartmentNumber || '',
        t.electricityMeter || '',
        t.waterMeter || '',
        t.notes || '',
        now,
        toBooleanInt(t.archived) ?? 0,
        toBooleanInt(t.active) ?? 1
      ]
    );
    const row = await db.get('SELECT * FROM tenants WHERE id = ?', result.lastID);
    res.json(row);
  });

  app.put('/api/tenants/:id', async (req, res) => {
    const t = req.body || {};
    await db.run(
      `UPDATE tenants SET
        firstName = ?, lastName = ?, nationalId = ?, phone = ?, startDate = ?, endDate = ?, moveOutDate = ?,
        rentAmount = ?, arnonaAmount = ?, apartmentNumber = ?, electricityMeter = ?, waterMeter = ?,
        notes = ?, archived = ?, active = ?
      WHERE id = ?`,
      [
        t.firstName || '',
        t.lastName || '',
        t.nationalId || '',
        t.phone || '',
        t.startDate || '',
        t.endDate || '',
        t.moveOutDate || '',
        t.rentAmount ?? null,
        t.arnonaAmount ?? null,
        t.apartmentNumber || '',
        t.electricityMeter || '',
        t.waterMeter || '',
        t.notes || '',
        toBooleanInt(t.archived) ?? 0,
        toBooleanInt(t.active) ?? 1,
        req.params.id
      ]
    );
    const row = await db.get('SELECT * FROM tenants WHERE id = ?', req.params.id);
    res.json(row);
  });

  app.delete('/api/tenants/:id', async (req, res) => {
    await db.run('DELETE FROM tenants WHERE id = ?', req.params.id);
    res.json({ ok: true });
  });

  // Delete all tenants (and related data)
  app.delete('/api/tenants', async (req, res) => {
    await db.run('DELETE FROM payments');
    await db.run('DELETE FROM bills');
    await db.run('DELETE FROM readings');
    await db.run('DELETE FROM tenants');
    res.json({ ok: true });
  });

  // Readings
  app.get('/api/readings', async (req, res) => {
    const rows = await db.all('SELECT * FROM readings ORDER BY date DESC, id DESC');
    res.json(rows);
  });

  app.get('/api/readings/:id', async (req, res) => {
    const row = await db.get('SELECT * FROM readings WHERE id = ?', req.params.id);
    if (!row) {
      res.status(404).send('Not found');
      return;
    }
    res.json(row);
  });

  app.post('/api/readings', async (req, res) => {
    const r = req.body || {};
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO readings (tenantId, meterType, date, value, createdAt) VALUES (?, ?, ?, ?, ?)',
      [r.tenantId ?? null, r.meterType || '', r.date || '', r.value ?? null, now]
    );
    const row = await db.get('SELECT * FROM readings WHERE id = ?', result.lastID);
    res.json(row);
  });

  app.delete('/api/readings/:id', async (req, res) => {
    await db.run('DELETE FROM readings WHERE id = ?', req.params.id);
    res.json({ ok: true });
  });

  app.put('/api/readings/:id', async (req, res) => {
    const r = req.body || {};
    await db.run(
      'UPDATE readings SET tenantId = ?, meterType = ?, date = ?, value = ? WHERE id = ?',
      [r.tenantId ?? null, r.meterType || '', r.date || '', r.value ?? null, req.params.id]
    );
    const row = await db.get('SELECT * FROM readings WHERE id = ?', req.params.id);
    if (!row) {
      res.status(404).send('Not found');
      return;
    }
    res.json(row);
  });

  app.delete('/api/readings', async (req, res) => {
    await db.run('DELETE FROM readings');
    res.json({ ok: true });
  });

  // Bills
  app.get('/api/bills', async (req, res) => {
    const rows = await db.all('SELECT * FROM bills ORDER BY month DESC, id DESC');
    res.json(rows);
  });

  app.post('/api/bills', async (req, res) => {
    const b = req.body || {};
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO bills (tenantId, month, electricity, water, total, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [b.tenantId ?? null, b.month || '', b.electricity ?? null, b.water ?? null, b.total ?? null, now]
    );
    const row = await db.get('SELECT * FROM bills WHERE id = ?', result.lastID);
    res.json(row);
  });

  app.delete('/api/bills/:id', async (req, res) => {
    await db.run('DELETE FROM bills WHERE id = ?', req.params.id);
    res.json({ ok: true });
  });

  // Payments
  app.get('/api/payments', async (req, res) => {
    const rows = await db.all('SELECT * FROM payments ORDER BY date DESC, id DESC');
    res.json(rows);
  });

  app.post('/api/payments', async (req, res) => {
    const p = req.body || {};
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO payments (tenantId, amount, method, account, date, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [p.tenantId ?? null, p.amount ?? null, p.method || '', p.account || '', p.date || '', p.notes || '', now]
    );
    const row = await db.get('SELECT * FROM payments WHERE id = ?', result.lastID);
    res.json(row);
  });

  app.put('/api/payments/:id', async (req, res) => {
    const p = req.body || {};
    await db.run(
      'UPDATE payments SET tenantId = ?, amount = ?, method = ?, account = ?, date = ?, notes = ? WHERE id = ?',
      [p.tenantId ?? null, p.amount ?? null, p.method || '', p.account || '', p.date || '', p.notes || '', req.params.id]
    );
    const row = await db.get('SELECT * FROM payments WHERE id = ?', req.params.id);
    res.json(row);
  });

  app.delete('/api/payments/:id', async (req, res) => {
    await db.run('DELETE FROM payments WHERE id = ?', req.params.id);
    res.json({ ok: true });
  });

  // Settings
  app.get('/api/settings', async (req, res) => {
    const rows = await db.all('SELECT * FROM settings');
    res.json(rows);
  });

  app.get('/api/settings/:key', async (req, res) => {
    const row = await db.get('SELECT * FROM settings WHERE key = ?', req.params.key);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.put('/api/settings/:key', async (req, res) => {
    const value = req.body?.value ?? '';
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [req.params.key, String(value)]
    );
    const row = await db.get('SELECT * FROM settings WHERE key = ?', req.params.key);
    res.json(row);
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();
