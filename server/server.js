const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { initDb } = require('./db');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function toBooleanInt(value) {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
}

function parseSettingValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  const canBeJson =
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"') ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^-?\d+(\.\d+)?$/.test(trimmed);
  if (!canBeJson) return value;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return value;
  }
}

function parseDateToIso(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const euMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (euMatch) return `${euMatch[3]}-${euMatch[2]}-${euMatch[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parsePeriodMonths(period) {
  const raw = String(period || '').trim();
  if (!raw) return null;
  const parts = raw.match(/\d+/g) || [];
  if (parts.length === 0) return null;

  const yearPart = parts.find(p => p.length === 4) || parts[parts.length - 1];
  const year = Number(yearPart);
  if (Number.isNaN(year) || String(yearPart).length !== 4) return null;

  const monthParts = parts.filter(p => p !== yearPart).map(n => Number(n)).filter(n => !Number.isNaN(n));
  if (monthParts.length === 0) {
    return { months: Array.from({ length: 12 }, (_, i) => i + 1), year };
  }

  let startMonth = monthParts[0];
  let endMonth = monthParts.length > 1 ? monthParts[1] : monthParts[0];
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return null;
  if (endMonth < startMonth) [startMonth, endMonth] = [endMonth, startMonth];
  const months = [];
  for (let m = startMonth; m <= endMonth; m++) months.push(m);
  return { months, year };
}

function parseParentPaymentPeriods(text) {
  const lines = String(text || '').split('\n');
  const periods = [];
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(',');
    if (parts.length < 2) return;
    const periodText = parts[0].trim();
    const amount = Number(parts.slice(1).join(',').trim());
    const parsed = parsePeriodMonths(periodText);
    if (!parsed || Number.isNaN(amount)) return;
    periods.push({ year: parsed.year, months: parsed.months, amount });
  });
  return periods;
}

function isGrandmaAccount(accountValue) {
  const raw = String(accountValue || '').trim();
  if (!raw) return false;
  if (raw === 'grandma') return true;
  return raw === 'חשבון אסתר ומיכאל' || raw === 'אסתר ומיכאל';
}

async function ensureInitialAdmin(db) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const normalizedEmail = String(ADMIN_EMAIL).toLowerCase().trim();
  const existing = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) return;
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const now = new Date().toISOString();
  await db.run(
    'INSERT INTO users (email, passwordHash, role, canWrite, canSubmitReadings, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [normalizedEmail, hash, 'admin', 1, 1, 1, now]
  );
  console.log(`Created initial admin: ${normalizedEmail}`);
}

function getTokenFromRequest(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

async function getUserWithTenant(db, userId) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user || !user.isActive) return null;
  const tenantRow = await db.get('SELECT tenantId FROM user_tenants WHERE userId = ?', [userId]);
  const tenantId = tenantRow ? tenantRow.tenantId : null;
  return { user, tenantId };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      canWrite: !!user.canWrite,
      canSubmitReadings: !!user.canSubmitReadings
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(db) {
  return async (req, res, next) => {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const result = await getUserWithTenant(db, payload.sub);
      if (!result) return res.status(401).json({ error: 'Invalid token' });
      req.user = result.user;
      req.userTenantId = result.tenantId;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function canWrite(user) {
  return isAdmin(user) || (user?.role === 'family' && user?.canWrite);
}

function canSubmitReadings(user) {
  return canWrite(user) || (user?.role === 'tenant' && user?.canSubmitReadings);
}

function toUserDto(user, tenantId = null) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    canWrite: !!user.canWrite,
    canSubmitReadings: !!user.canSubmitReadings,
    isActive: !!user.isActive,
    tenantId
  };
}

function respondDbError(res, err) {
  if (err && err.code === 'SQLITE_CONSTRAINT') {
    return res.status(400).json({ error: 'Invalid reference', detail: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'Server error' });
}

(async () => {
  const db = await initDb();

  if (!JWT_SECRET) {
    console.error('JWT_SECRET is required. Set it in the environment or .env file.');
    process.exit(1);
  }

  await ensureInitialAdmin(db);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  
  // Serve static files from parent directory (the app files)
  app.use(express.static(path.join(__dirname, '..')));

  app.get('/mom', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'mom.html'));
  });

  app.get('/public/mom-data', async (req, res) => {
    try {
      const payments = await db.all('SELECT * FROM payments');
      const settingsRows = await db.all('SELECT * FROM settings');
      const settings = new Map(settingsRows.map(row => [row.key, parseSettingValue(row.value)]));

      const parentDefaultRaw = settings.get('parentPaymentDefault');
      const parentPeriodsText = settings.get('parentPaymentPeriods') || '';
      const parentExempt = settings.get('parentPaymentExemptMonths');
      const parentReductionsRaw = settings.get('parentPaymentReductions');

      const parentDefault = Number(parentDefaultRaw ?? 4400) || 0;
      const parentPeriods = parseParentPaymentPeriods(parentPeriodsText || '');
      const parentExemptSet = new Set(Array.isArray(parentExempt) ? parentExempt : []);
      const parentReductions = parentReductionsRaw && typeof parentReductionsRaw === 'object'
        ? parentReductionsRaw
        : {};

      const parentPaymentsByMonth = new Map();
      payments
        .filter(p => isGrandmaAccount(p.account))
        .forEach(p => {
          const iso = parseDateToIso(p.date);
          if (!iso) return;
          const key = iso.slice(0, 7);
          parentPaymentsByMonth.set(key, (parentPaymentsByMonth.get(key) || 0) + Number(p.amount || 0));
        });

      const allMonths = [];
      parentPeriods.forEach(p => {
        p.months.forEach(m => {
          allMonths.push(`${p.year}-${String(m).padStart(2, '0')}`);
        });
      });
      parentPaymentsByMonth.forEach((_, key) => allMonths.push(key));
      parentExemptSet.forEach(key => allMonths.push(key));
      Object.keys(parentReductions).forEach(key => allMonths.push(key));

      let parentMonths = [];
      if (allMonths.length > 0) {
        allMonths.sort();
        const firstMonth = allMonths[0];
        let lastMonth;
        if (parentPaymentsByMonth.size > 0) {
          const lastPaymentMonth = Array.from(parentPaymentsByMonth.keys()).sort().pop();
          const [year, month] = lastPaymentMonth.split('-').map(Number);
          const nextMonth = month === 12 ? 1 : month + 1;
          const nextYear = month === 12 ? year + 1 : year;
          lastMonth = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
        } else {
          lastMonth = allMonths[allMonths.length - 1];
        }

        const parentMonthSet = new Set();
        let [currentYear, currentMonth] = firstMonth.split('-').map(Number);
        const [endYear, endMonth] = lastMonth.split('-').map(Number);
        while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
          parentMonthSet.add(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
          currentMonth++;
          if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
          }
        }
        parentMonths = Array.from(parentMonthSet).sort();
      }

      let cumulativeBalance = 0;
      const rows = parentMonths.map(key => {
        const year = Number(key.slice(0, 4));
        const month = Number(key.slice(5, 7));
        let obligation = parentDefault;
        parentPeriods.forEach(p => {
          if (p.year === year && p.months.includes(month)) obligation = p.amount;
        });
        const isExempt = parentExemptSet.has(key);
        if (isExempt) obligation = 0;

        const reduction = parentReductions[key] || {};
        const reductionAmount = Number(reduction.amount || 0);
        const reductionReason = reduction.reason || '';

        const finalObligation = obligation - reductionAmount;
        const paid = parentPaymentsByMonth.get(key) || 0;
        const balance = paid - finalObligation;
        cumulativeBalance += balance;

        return {
          key,
          label: `${key.slice(5, 7)}/${key.slice(0, 4)}`,
          obligation,
          reductionAmount,
          reductionReason,
          paid,
          balance,
          cumulativeBalance,
          isExempt
        };
      });

      res.json({
        title: 'תשלום לאסתר ומיכאל',
        rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  const authRequired = requireAuth(db);

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });
    const user = await db.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
    if (!user || !user.isActive) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(String(password), user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const tenantRow = await db.get('SELECT tenantId FROM user_tenants WHERE userId = ?', [user.id]);
    const token = signToken(user);
    res.json({
      token,
      user: toUserDto(user, tenantRow ? tenantRow.tenantId : null)
    });
  });

  app.get('/api/auth/me', authRequired, async (req, res) => {
    res.json({ user: toUserDto(req.user, req.userTenantId) });
  });

  // Users (admin only)
  app.get('/api/users', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const rows = await db.all(
      'SELECT u.*, ut.tenantId FROM users u LEFT JOIN user_tenants ut ON u.id = ut.userId ORDER BY u.id DESC'
    );
    res.json(rows.map(row => toUserDto(row, row.tenantId)));
  });

  app.post('/api/users', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'family');
    const allowedRoles = new Set(['admin', 'family', 'tenant']);
    if (!email || !password) return res.status(400).json({ error: 'Missing email/password' });
    if (!allowedRoles.has(role)) return res.status(400).json({ error: 'Invalid role' });

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const canWriteValue = role === 'admin' ? 1 : (toBooleanInt(req.body?.canWrite) ?? 0);
    const canSubmitReadingsValue = role === 'tenant' ? (toBooleanInt(req.body?.canSubmitReadings) ?? 0) : (role === 'admin' ? 1 : 0);
    const isActiveValue = toBooleanInt(req.body?.isActive) ?? 1;

    if (role === 'tenant' && !req.body?.tenantId) {
      return res.status(400).json({ error: 'Missing tenantId for tenant role' });
    }

    try {
      const result = await db.run(
        'INSERT INTO users (email, passwordHash, role, canWrite, canSubmitReadings, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [email, hash, role, canWriteValue, canSubmitReadingsValue, isActiveValue, now]
      );

      if (role === 'tenant') {
        await db.run('INSERT INTO user_tenants (userId, tenantId) VALUES (?, ?)', [result.lastID, req.body.tenantId]);
      }

      const created = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
      const tenantRow = await db.get('SELECT tenantId FROM user_tenants WHERE userId = ?', [result.lastID]);
      res.json(toUserDto(created, tenantRow ? tenantRow.tenantId : null));
    } catch (err) {
      return respondDbError(res, err);
    }
  });

  app.put('/api/users/:id', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const userId = req.params.id;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : user.email;
    const role = req.body?.role ? String(req.body.role) : user.role;
    const allowedRoles = new Set(['admin', 'family', 'tenant']);
    if (!allowedRoles.has(role)) return res.status(400).json({ error: 'Invalid role' });

    let passwordHash = user.passwordHash;
    if (req.body?.password) {
      passwordHash = await bcrypt.hash(String(req.body.password), 10);
    }

    const canWriteValue = role === 'admin' ? 1 : (toBooleanInt(req.body?.canWrite) ?? user.canWrite ?? 0);
    const canSubmitReadingsValue = role === 'tenant'
      ? (toBooleanInt(req.body?.canSubmitReadings) ?? user.canSubmitReadings ?? 0)
      : (role === 'admin' ? 1 : 0);
    const isActiveValue = toBooleanInt(req.body?.isActive) ?? user.isActive ?? 1;

    try {
      await db.run(
        'UPDATE users SET email = ?, passwordHash = ?, role = ?, canWrite = ?, canSubmitReadings = ?, isActive = ? WHERE id = ?',
        [email, passwordHash, role, canWriteValue, canSubmitReadingsValue, isActiveValue, userId]
      );

      if (role === 'tenant' && !req.body?.tenantId) {
        return res.status(400).json({ error: 'Missing tenantId for tenant role' });
      }

      await db.run('DELETE FROM user_tenants WHERE userId = ?', [userId]);
      if (role === 'tenant') {
        await db.run('INSERT INTO user_tenants (userId, tenantId) VALUES (?, ?)', [userId, req.body.tenantId]);
      }

      const updated = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
      const tenantRow = await db.get('SELECT tenantId FROM user_tenants WHERE userId = ?', [userId]);
      res.json(toUserDto(updated, tenantRow ? tenantRow.tenantId : null));
    } catch (err) {
      return respondDbError(res, err);
    }
  });

  // Tenants
  app.get('/api/tenants', authRequired, async (req, res) => {
    if (req.user.role === 'tenant') {
      if (!req.userTenantId) return res.json([]);
      const row = await db.get('SELECT * FROM tenants WHERE id = ?', [req.userTenantId]);
      return res.json(row ? [row] : []);
    }
    const includeArchived = req.query.includeArchived === 'true';
    const rows = includeArchived
      ? await db.all('SELECT * FROM tenants ORDER BY id DESC')
      : await db.all('SELECT * FROM tenants WHERE archived = 0 ORDER BY id DESC');
    res.json(rows);
  });

  app.get('/api/tenants/:id', authRequired, async (req, res) => {
    if (req.user.role === 'tenant' && Number(req.params.id) !== Number(req.userTenantId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const row = await db.get('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.post('/api/tenants', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
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
    const row = await db.get('SELECT * FROM tenants WHERE id = ?', [result.lastID]);
    res.json(row);
  });

  app.put('/api/tenants/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
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
    const row = await db.get('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    res.json(row);
  });

  app.delete('/api/tenants/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM tenants WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // Delete all tenants (and related data)
  app.delete('/api/tenants', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM payments');
    await db.run('DELETE FROM bills');
    await db.run('DELETE FROM readings');
    await db.run('DELETE FROM tenants');
    res.json({ ok: true });
  });

  // Readings
  app.get('/api/readings', authRequired, async (req, res) => {
    if (req.user.role === 'tenant') {
      if (!req.userTenantId) return res.json([]);
      const rows = await db.all(
        'SELECT * FROM readings WHERE tenantId = ? ORDER BY date DESC, id DESC',
        [req.userTenantId]
      );
      return res.json(rows);
    }
    const rows = await db.all('SELECT * FROM readings ORDER BY date DESC, id DESC');
    res.json(rows);
  });

  app.get('/api/readings/pending', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const rows = await db.all(
      "SELECT * FROM readings WHERE status = 'pending' ORDER BY date DESC, id DESC"
    );
    res.json(rows);
  });

  app.get('/api/readings/:id', authRequired, async (req, res) => {
    const row = await db.get('SELECT * FROM readings WHERE id = ?', [req.params.id]);
    if (!row) {
      res.status(404).send('Not found');
      return;
    }
    if (req.user.role === 'tenant' && Number(row.tenantId) !== Number(req.userTenantId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(row);
  });

  app.post('/api/readings', authRequired, async (req, res) => {
    const r = req.body || {};
    const now = new Date().toISOString();
    let tenantId = r.tenantId ?? null;
    let status = 'approved';
    let submittedByUserId = null;
    let approvedByUserId = null;
    let approvedAt = null;

    if (req.user.role === 'tenant') {
      if (!canSubmitReadings(req.user)) return res.status(403).json({ error: 'Forbidden' });
      if (!req.userTenantId) return res.status(400).json({ error: 'Missing tenant assignment' });
      tenantId = req.userTenantId;
      status = 'pending';
      submittedByUserId = req.user.id;
    } else {
      if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
      if (r.status === 'pending' || r.status === 'approved') {
        status = r.status;
      }
      if (status === 'approved') {
        approvedByUserId = req.user.id;
        approvedAt = now;
      }
    }

    try {
      const result = await db.run(
        'INSERT INTO readings (tenantId, meterType, date, value, paid, createdAt, status, submittedByUserId, approvedByUserId, approvedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [tenantId, r.meterType || '', r.date || '', r.value ?? null, toBooleanInt(r.paid) ?? 0, now, status, submittedByUserId, approvedByUserId, approvedAt]
      );
      const row = await db.get('SELECT * FROM readings WHERE id = ?', [result.lastID]);
      res.json(row);
    } catch (err) {
      return respondDbError(res, err);
    }
  });

  app.delete('/api/readings/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM readings WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.put('/api/readings/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const r = req.body || {};
    const now = new Date().toISOString();
    let approvedByUserId = r.approvedByUserId ?? null;
    let approvedAt = r.approvedAt ?? null;
    if (r.status === 'approved') {
      approvedByUserId = req.user.id;
      approvedAt = now;
    }
    try {
      await db.run(
        'UPDATE readings SET tenantId = ?, meterType = ?, date = ?, value = ?, paid = ?, status = ?, approvedByUserId = ?, approvedAt = ? WHERE id = ?',
        [r.tenantId ?? null, r.meterType || '', r.date || '', r.value ?? null, toBooleanInt(r.paid) ?? 0, r.status || 'approved', approvedByUserId, approvedAt, req.params.id]
      );
      const row = await db.get('SELECT * FROM readings WHERE id = ?', [req.params.id]);
      if (!row) {
        res.status(404).send('Not found');
        return;
      }
      res.json(row);
    } catch (err) {
      return respondDbError(res, err);
    }
  });

  app.delete('/api/readings', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM readings');
    res.json({ ok: true });
  });

  // Bills
  app.get('/api/bills', authRequired, async (req, res) => {
    if (req.user.role === 'tenant') {
      if (!req.userTenantId) return res.json([]);
      const rows = await db.all(
        'SELECT * FROM bills WHERE tenantId = ? ORDER BY month DESC, id DESC',
        [req.userTenantId]
      );
      return res.json(rows);
    }
    const rows = await db.all('SELECT * FROM bills ORDER BY month DESC, id DESC');
    res.json(rows);
  });

  app.post('/api/bills', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const b = req.body || {};
    const now = new Date().toISOString();
    try {
      const result = await db.run(
        'INSERT INTO bills (tenantId, month, electricity, water, total, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [b.tenantId ?? null, b.month || '', b.electricity ?? null, b.water ?? null, b.total ?? null, now]
      );
      const row = await db.get('SELECT * FROM bills WHERE id = ?', [result.lastID]);
      res.json(row);
    } catch (err) {
      return respondDbError(res, err);
    }
  });

  app.delete('/api/bills/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM bills WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.delete('/api/bills', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM bills');
    res.json({ ok: true });
  });

  // Payments
  app.get('/api/payments', authRequired, async (req, res) => {
    if (req.user.role === 'tenant') {
      if (!req.userTenantId) return res.json([]);
      const rows = await db.all(
        'SELECT * FROM payments WHERE tenantId = ? ORDER BY date DESC, id DESC',
        [req.userTenantId]
      );
      return res.json(rows);
    }
    const rows = await db.all('SELECT * FROM payments ORDER BY date DESC, id DESC');
    res.json(rows);
  });

  app.post('/api/payments', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const p = req.body || {};
    const now = new Date().toISOString();
    try {
      const result = await db.run(
        'INSERT INTO payments (tenantId, amount, method, account, date, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.tenantId ?? null, p.amount ?? null, p.method || '', p.account || '', p.date || '', p.notes || '', now]
      );
      const row = await db.get('SELECT * FROM payments WHERE id = ?', [result.lastID]);
      res.json(row);
    } catch (err) {
      return respondDbError(res, err);
    }
  });

  app.put('/api/payments/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const p = req.body || {};
    try {
      await db.run(
        'UPDATE payments SET tenantId = ?, amount = ?, method = ?, account = ?, date = ?, notes = ? WHERE id = ?',
        [p.tenantId ?? null, p.amount ?? null, p.method || '', p.account || '', p.date || '', p.notes || '', req.params.id]
      );
      const row = await db.get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
      res.json(row);
    } catch (err) {
      return respondDbError(res, err);
    }
  });

  app.delete('/api/payments/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM payments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.delete('/api/payments', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM payments');
    res.json({ ok: true });
  });

  // Expenses
  app.get('/api/expenses', authRequired, async (req, res) => {
    if (req.user.role === 'tenant') return res.json([]);
    const rows = await db.all('SELECT * FROM expenses ORDER BY date DESC, id DESC');
    res.json(rows);
  });

  app.post('/api/expenses', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const e = req.body || {};
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO expenses (type, period, amount, frequency, date, paid, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [e.type || '', e.period || '', e.amount ?? null, e.frequency || '', e.date || '', toBooleanInt(e.paid) ?? 0, now]
    );
    const row = await db.get('SELECT * FROM expenses WHERE id = ?', [result.lastID]);
    res.json(row);
  });

  app.put('/api/expenses/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const e = req.body || {};
    await db.run(
      'UPDATE expenses SET type = ?, period = ?, amount = ?, frequency = ?, date = ?, paid = ? WHERE id = ?',
      [e.type || '', e.period || '', e.amount ?? null, e.frequency || '', e.date || '', toBooleanInt(e.paid) ?? 0, req.params.id]
    );
    const row = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    res.json(row);
  });

  app.delete('/api/expenses/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.delete('/api/expenses', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM expenses');
    res.json({ ok: true });
  });

  // Solar income
  app.get('/api/solar', authRequired, async (req, res) => {
    if (req.user.role === 'tenant') return res.json([]);
    const rows = await db.all('SELECT * FROM solar ORDER BY period DESC, id DESC');
    res.json(rows);
  });

  app.post('/api/solar', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const s = req.body || {};
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO solar (period, amount, date, createdAt) VALUES (?, ?, ?, ?)',
      [s.period || '', s.amount ?? null, s.date || '', now]
    );
    const row = await db.get('SELECT * FROM solar WHERE id = ?', [result.lastID]);
    res.json(row);
  });

  app.put('/api/solar/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const s = req.body || {};
    await db.run(
      'UPDATE solar SET period = ?, amount = ?, date = ? WHERE id = ?',
      [s.period || '', s.amount ?? null, s.date || '', req.params.id]
    );
    const row = await db.get('SELECT * FROM solar WHERE id = ?', [req.params.id]);
    res.json(row);
  });

  app.delete('/api/solar/:id', authRequired, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM solar WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.delete('/api/solar', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM solar');
    res.json({ ok: true });
  });

  // Settings
  app.get('/api/settings', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const rows = await db.all('SELECT * FROM settings');
    res.json(rows);
  });

  app.get('/api/settings/:key', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const row = await db.get('SELECT * FROM settings WHERE key = ?', [req.params.key]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  app.put('/api/settings/:key', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const value = req.body?.value ?? '';
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [req.params.key, serializedValue]
    );
    const row = await db.get('SELECT * FROM settings WHERE key = ?', [req.params.key]);
    res.json(row);
  });

  app.delete('/api/settings', authRequired, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM settings');
    res.json({ ok: true });
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();
