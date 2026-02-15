// Tenant Management App - Vanilla JS + IndexedDB
const DB_NAME = 'tenant_mgmt_v1';
const DB_VERSION = 4;
const STORES = ['tenants', 'readings', 'bills', 'payments', 'expenses', 'settings'];

function isRemoteApp() {
  return window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
}

// Get API base URL - auto-detect or use saved settings
function getApiBase() {
  // If accessed via Cloudflare (not localhost), use same origin for API
  if (isRemoteApp()) {
    return window.location.origin;
  }
  // Otherwise use saved server URL or localhost
  return window.CURRENT_SERVER_URL || 'http://localhost:3001';
}

async function apiRequest(path, options = {}) {
  const API_BASE = getApiBase();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    const message = text ? `HTTP ${res.status} ${text}` : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

function normalizeTenantRow(row) {
  if (!row) return row;
  return {
    ...row,
    archived: !!row.archived,
    active: row.active === undefined ? true : !!row.active
  };
}

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      STORES.forEach(st => {
        if (!db.objectStoreNames.contains(st)) {
          const s = db.createObjectStore(st, { keyPath: st === 'settings' ? 'key' : 'id', autoIncrement: st !== 'settings' });
          if (st !== 'settings') {
            s.createIndex('tenantId', 'tenantId', { unique: false });
            s.createIndex('date', 'date', { unique: false });
          }
        }
      });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function getTx(store, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(store, mode);
}

// Tenants (local IndexedDB)
async function addTenant(data) {
  const tx = await getTx('tenants', 'readwrite');
  data.createdAt = new Date().toISOString();
  if (data.archived === undefined) data.archived = false;
  return new Promise((res, rej) => {
    const r = tx.objectStore('tenants').add(data);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function updateTenant(id, patch) {
  const tx = await getTx('tenants', 'readwrite');
  const store = tx.objectStore('tenants');
  return new Promise((res, rej) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (!rec) return rej(new Error('Not found'));
      Object.assign(rec, patch);
      const putReq = store.put(rec);
      putReq.onsuccess = () => res();
      putReq.onerror = () => rej(putReq.error);
    };
    getReq.onerror = () => rej(getReq.error);
  });
}

async function deleteTenant(id) {
  const tx = await getTx('tenants', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('tenants').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getAllTenants(includeArchived = false) {
  // Always read from local IndexedDB
  const tx = await getTx('tenants', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('tenants').getAll();
    r.onsuccess = () => {
      const all = r.result || [];
      const filtered = all.filter(t => (includeArchived ? true : !t.archived));
      res(filtered);
    };
    r.onerror = () => rej(r.error);
  });
}

async function getTenantById(id) {
  const tx = await getTx('tenants', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('tenants').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

async function clearAllTenants() {
  const tx = await getTx('tenants', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('tenants').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// Tenants (remote API for sync)
function extractTenantFields(t) {
  return {
    firstName: t.firstName || '',
    lastName: t.lastName || '',
    nationalId: t.nationalId || '',
    phone: t.phone || '',
    startDate: t.startDate || '',
    endDate: t.endDate || '',
    moveOutDate: t.moveOutDate || '',
    rentAmount: t.rentAmount ?? null,
    arnonaAmount: t.arnonaAmount ?? null,
    apartmentNumber: t.apartmentNumber || '',
    electricityMeter: t.electricityMeter || '',
    waterMeter: t.waterMeter || '',
    notes: t.notes || '',
    archived: t.archived ?? false,
    active: t.active ?? true
  };
}

async function addTenantRemote(data) {
  const payload = extractTenantFields(data);
  const row = await apiRequest('/api/tenants', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return normalizeTenantRow(row);
}

async function updateTenantRemote(id, data) {
  const payload = extractTenantFields(data);
  await apiRequest(`/api/tenants/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

async function deleteTenantRemote(id) {
  await apiRequest(`/api/tenants/${id}`, { method: 'DELETE' });
}

async function getAllTenantsRemote(includeArchived = false) {
  const rows = await apiRequest(`/api/tenants?includeArchived=${includeArchived ? 'true' : 'false'}`);
  return (rows || []).map(normalizeTenantRow);
}

async function getTenantByIdRemote(id) {
  try {
    const row = await apiRequest(`/api/tenants/${id}`);
    return normalizeTenantRow(row);
  } catch (err) {
    if (String(err.message || '').includes('404')) return null;
    throw err;
  }
}

// Readings
async function addReading(reading) {
  const tx = await getTx('readings', 'readwrite');
  reading.createdAt = new Date().toISOString();

  const store = tx.objectStore('readings');
  const allReadings = await new Promise((res, rej) => {
    const r = store.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });

  const isDuplicate = allReadings.some(existing =>
    existing.tenantId === reading.tenantId &&
    existing.meterType === reading.meterType &&
    existing.date === reading.date
  );

  if (isDuplicate) {
    throw new Error('קריאה עם תאריך זה כבר קיימת לדייר זה');
  }

  return new Promise((res, rej) => {
    const r = store.add(reading);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function addReadingRemote(reading) {
  const payload = {
    tenantId: reading.tenantId ?? null,
    meterType: reading.meterType || '',
    date: reading.date || '',
    value: reading.value ?? null
  };
  return await apiRequest('/api/readings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function addReadingRemote(reading) {
  const payload = {
    tenantId: reading.tenantId ?? null,
    meterType: reading.meterType || '',
    date: reading.date || '',
    value: reading.value ?? null
  };
  return await apiRequest('/api/readings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function getReadingsByTenant(tenantId) {
  const tx = await getTx('readings', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('readings').index('tenantId').getAll(tenantId);
    r.onsuccess = () => {
      const arr = (r.result || []).sort((a, b) => new Date(a.date) - new Date(b.date));
      res(arr);
    };
    r.onerror = () => rej(r.error);
  });
}

async function getAllReadings() {
  const tx = await getTx('readings', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('readings').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function getAllReadingsRemote() {
  const rows = await apiRequest('/api/readings');
  return rows || [];
}

async function getAllReadingsRemote() {
  const rows = await apiRequest('/api/readings');
  return rows || [];
}

async function clearAllReadings() {
  const tx = await getTx('readings', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('readings').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function updateReading(id, patch) {
  const tx = await getTx('readings', 'readwrite');
  const store = tx.objectStore('readings');
  return new Promise((res, rej) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (!rec) return rej(new Error('Not found'));
      Object.assign(rec, patch);
      const putReq = store.put(rec);
      putReq.onsuccess = () => res(putReq.result);
      putReq.onerror = () => rej(putReq.error);
    };
    getReq.onerror = () => rej(getReq.error);
  });
}

async function getReadingByIdRemote(id) {
  try {
    return await apiRequest(`/api/readings/${id}`);
  } catch (err) {
    if (String(err.message || '').includes('404')) return null;
    throw err;
  }
}

async function updateReadingRemote(id, patch) {
  return await apiRequest(`/api/readings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch)
  });
}

async function deleteReadingRemote(id) {
  await apiRequest(`/api/readings/${id}`, { method: 'DELETE' });
}

async function deleteReading(id) {
  const tx = await getTx('readings', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('readings').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function removeDuplicateReadings() {
  const all = await getAllReadings();
  const seen = new Set();
  const toDelete = [];

  all.forEach(r => {
    const key = `${r.tenantId}-${r.meterType}-${r.date}`;
    if (seen.has(key)) {
      toDelete.push(r.id);
    } else {
      seen.add(key);
    }
  });

  for (const id of toDelete) {
    const tx = await getTx('readings', 'readwrite');
    await new Promise((res, rej) => {
      const r = tx.objectStore('readings').delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  return toDelete.length;
}

async function detachTenantData(tenantId) {
  const tenant = await getTenantById(tenantId);
  if (!tenant) return;
  const name = `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim();
  const apartment = tenant.apartmentNumber || '';

  const readings = await getReadingsByTenant(tenantId);
  for (const r of readings) {
    await updateReading(r.id, { tenantId: null, tenantName: name, apartmentNumber: apartment });
  }

  const payments = await getPaymentsByTenant(tenantId);
  for (const p of payments) {
    await updatePayment(p.id, { tenantId: null, tenantName: name, apartmentNumber: apartment });
  }
}

// Payments
async function addPayment(p) {
  const tx = await getTx('payments', 'readwrite');
  p.createdAt = new Date().toISOString();
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').add(p);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function updatePayment(id, patch) {
  const tx = await getTx('payments', 'readwrite');
  const store = tx.objectStore('payments');
  return new Promise((res, rej) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (!rec) return rej(new Error('Not found'));
      Object.assign(rec, patch);
      const putReq = store.put(rec);
      putReq.onsuccess = () => res(putReq.result);
      putReq.onerror = () => rej(putReq.error);
    };
    getReq.onerror = () => rej(getReq.error);
  });
}

async function deletePayment(id) {
  const tx = await getTx('payments', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getAllPayments() {
  const tx = await getTx('payments', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function getPaymentsByTenant(tenantId) {
  const tx = await getTx('payments', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').index('tenantId').getAll(tenantId);
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function clearAllPayments() {
  const tx = await getTx('payments', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

const paymentsSort = { key: null, dir: 'asc' };

function comparePayments(a, b, tenantMap, key) {
  const tA = tenantMap.get(a.tenantId) || {};
  const tB = tenantMap.get(b.tenantId) || {};
  switch (key) {
    case 'date':
      return new Date(a.date) - new Date(b.date);
    case 'apartment':
      return Number(tA.apartmentNumber || a.apartmentNumber || 0) - Number(tB.apartmentNumber || b.apartmentNumber || 0);
    case 'tenant':
      return (`${tA.firstName || ''} ${tA.lastName || ''}`.trim() || a.tenantName || '').localeCompare(`${tB.firstName || ''} ${tB.lastName || ''}`.trim() || b.tenantName || '');
    case 'amount':
      return Number(a.amount) - Number(b.amount);
    case 'account':
      return accountLabel(a.account).localeCompare(accountLabel(b.account));
    case 'method':
      return String(a.method || '').localeCompare(String(b.method || ''));
    case 'notes':
      return String(a.notes || '').localeCompare(String(b.notes || ''));
    default:
      return 0;
  }
}

function formatDateEu(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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

function accountLabel(accountValue) {
  if (accountValue === 'grandma') return 'חשבון אסתר ומיכאל';
  if (accountValue === 'my') return 'חשבון ניר וליאור';
  return accountValue || '';
}

function meterTypeLabel(meterType) {
  if (meterType === 'electricity') return 'חשמל';
  if (meterType === 'water') return 'מים';
  return meterType || '';
}

function meterTypeFromCsv(value) {
  const raw = String(value || '').trim();
  if (raw === 'חשמל' || raw.toLowerCase() === 'electricity') return 'electricity';
  if (raw === 'מים' || raw.toLowerCase() === 'water') return 'water';
  return '';
}

function accountValueFromCsv(value) {
  const raw = String(value || '').trim();
  if (raw === 'חשבון אסתר ומיכאל') return 'grandma';
  if (raw === 'חשבון ניר וליאור') return 'my';
  return accountValueFromEnglish(raw);
}

function methodLabel(methodValue) {
  if (methodValue === 'cash') return 'מזומן';
  if (methodValue === 'check') return "צ'ק";
  if (methodValue === 'bit') return 'ביט';
  if (methodValue === 'transfer') return 'העברה';
  return methodValue || '';
}

function methodValueFromCsv(value) {
  const raw = String(value || '').trim();
  if (raw === 'מזומן') return 'cash';
  if (raw === "צ'ק") return 'check';
  if (raw === 'ביט') return 'bit';
  if (raw === 'העברה') return 'transfer';
  const v = raw.toLowerCase();
  if (v === 'cash' || v === 'check' || v === 'bit' || v === 'transfer') return v;
  return 'check';
}

function accountValueFromEnglish(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'esther_michael' || v === 'esther&michel' || v === 'esther_and_michael') return 'grandma';
  if (v === 'nir_lior' || v === 'nir&lior' || v === 'nir_and_lior') return 'my';
  if (v === 'grandma') return 'grandma';
  if (v === 'my') return 'my';
  return v;
}

function accountEnglishLabel(value) {
  if (value === 'grandma') return 'esther_michael';
  if (value === 'my') return 'nir_lior';
  return String(value || '');
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function readCsvWithEncoding(file) {
  const buffer = await file.arrayBuffer();
  const utf8Text = new TextDecoder('utf-8').decode(buffer);
  if (utf8Text.includes('\uFFFD')) {
    try {
      return new TextDecoder('windows-1255').decode(buffer);
    } catch (e) {
      return utf8Text;
    }
  }
  return utf8Text;
}

function parseMonthYear(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const nums = raw.match(/\d+/g) || [];

  if (nums.length >= 2) {
    let month = Number(nums[0]);
    let year = Number(nums[1]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    return { month, year };
  }

  if (nums.length === 1) {
    let year = Number(nums[0]);
    if (year < 100) year += 2000;
    const hebMonths = [
      { key: 'ינו', month: 1 },
      { key: 'פבר', month: 2 },
      { key: 'מרץ', month: 3 },
      { key: 'אפר', month: 4 },
      { key: 'מאי', month: 5 },
      { key: 'יונ', month: 6 },
      { key: 'יול', month: 7 },
      { key: 'אוג', month: 8 },
      { key: 'ספט', month: 9 },
      { key: 'אוק', month: 10 },
      { key: 'נוב', month: 11 },
      { key: 'דצ', month: 12 }
    ];
    for (const m of hebMonths) {
      if (raw.includes(m.key)) {
        return { month: m.month, year };
      }
    }
  }

  return null;
}

function parseDay(value) {
  if (!value) return null;
  const nums = String(value).match(/\d+/g);
  if (!nums || nums.length < 1) return null;
  const day = Number(nums[0]);
  if (day < 1 || day > 31) return null;
  return day;
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function parseCsvBoolean(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'כן') return true;
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'לא') return false;
  return false;
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildTenantName(t) {
  return `${t.firstName || ''} ${t.lastName || ''}`.trim();
}

function buildPaymentKey(tenantId, tenantName, apartmentNumber, date, amount, account) {
  const name = normalizeName(tenantName);
  const apt = String(apartmentNumber || '').trim();
  const idPart = tenantId ? String(tenantId) : `${name}|${apt}`;
  return `${idPart}|${date}|${amount}|${account}`;
}

function buildTenantNameIndex(tenants) {
  const map = new Map();
  tenants.forEach(t => {
    const key = normalizeName(buildTenantName(t));
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  });
  return map;
}

function findTenantByName(nameIndex, fullName) {
  const key = normalizeName(fullName);
  if (!key) return null;
  const matches = nameIndex.get(key) || [];
  if (matches.length !== 1) return null;
  return matches[0];
}

async function exportTenantsCsv() {
  const tenants = await getAllTenants(true);
  const rows = [
    ['apartment', 'first_name', 'last_name', 'national_id', 'phone', 'active', 'start_date', 'end_date', 'move_out_date', 'rent_amount', 'arnona_amount', 'electricity_meter', 'water_meter', 'notes', 'archived']
  ];

  tenants.slice().sort((a, b) => Number(a.apartmentNumber || 0) - Number(b.apartmentNumber || 0)).forEach(t => {
    rows.push([
      t.apartmentNumber || '',
      t.firstName || '',
      t.lastName || '',
      t.nationalId || '',
      t.phone || '',
      t.archived ? 'false' : 'true',
      t.startDate || '',
      t.endDate || '',
      t.moveOutDate || '',
      t.rentAmount ?? '',
      t.arnonaAmount ?? '',
      t.electricityMeter || '',
      t.waterMeter || '',
      t.notes || '',
      t.archived ? 'true' : 'false'
    ]);
  });

  const csv = rows.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  downloadCsv(csv, 'tenants.csv');
}

async function importTenantsCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('קובץ ריק');
  const rows = lines.map(parseCsvLine);
  const startIdx = rows[0][0]?.toLowerCase() === 'apartment' ? 1 : 0;

  const headerMap = {};
  if (startIdx === 1) {
    rows[0].forEach((h, i) => { headerMap[String(h || '').trim().toLowerCase()] = i; });
  }
  const idx = (name, fallback) => (headerMap[name] === undefined ? fallback : headerMap[name]);
  const activeIdx = headerMap['active'];
  const hasHeader = startIdx === 1;
  const legacyNoHeader = !hasHeader && rows[0].length <= 12;
  const startDateIdx = legacyNoHeader ? 5 : 6;
  const endDateIdx = legacyNoHeader ? 6 : 7;
  const moveOutDateIdx = legacyNoHeader ? -1 : 8;
  const rentIdx = legacyNoHeader ? 7 : 9;
  const arnonaIdx = legacyNoHeader ? null : 10;
  const elecIdx = legacyNoHeader ? 8 : 11;
  const waterIdx = legacyNoHeader ? 9 : 12;
  const notesIdx = legacyNoHeader ? 10 : 13;
  const archivedIdx = headerMap['archived'] === undefined
    ? (legacyNoHeader ? 11 : (activeIdx === undefined ? 14 : 14))
    : headerMap['archived'];

  const useRemote = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  const existing = useRemote ? await getAllTenantsRemote(true) : await getAllTenants(true);
  const byApartment = new Map(existing.map(t => [String(t.apartmentNumber || ''), t]));

  let total = 0, success = 0, updated = 0;

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const apartmentNumber = String(row[0] || '').trim();
    if (!apartmentNumber) continue;

    const data = {
      firstName: String(row[idx('first_name', 1)] || '').trim(),
      lastName: String(row[idx('last_name', 2)] || '').trim(),
      nationalId: String(row[idx('national_id', 3)] || '').trim(),
      phone: String(row[idx('phone', 4)] || '').trim(),
      startDate: normalizeDateString(row[idx('start_date', startDateIdx)]),
      endDate: normalizeDateString(row[idx('end_date', endDateIdx)]),
      moveOutDate: moveOutDateIdx >= 0 ? normalizeDateString(row[idx('move_out_date', moveOutDateIdx)]) : '',
      rentAmount: Number(String(row[idx('rent_amount', rentIdx)] || '').replace(/,/g, '')) || 0,
      arnonaAmount: arnonaIdx === null ? 0 : Number(String(row[idx('arnona_amount', arnonaIdx)] || '').replace(/,/g, '')) || 0,
      electricityMeter: String(row[idx('electricity_meter', elecIdx)] || '').trim(),
      waterMeter: String(row[idx('water_meter', waterIdx)] || '').trim(),
      notes: String(row[idx('notes', notesIdx)] || '').trim(),
      apartmentNumber: apartmentNumber,
      archived: activeIdx === undefined ? parseCsvBoolean(row[archivedIdx]) : !parseCsvBoolean(row[activeIdx])
    };

    total++;
    const existingTenant = byApartment.get(apartmentNumber);
    if (existingTenant) {
      if (useRemote) {
        await updateTenantRemote(existingTenant.id, data);
      } else {
        await updateTenant(existingTenant.id, data);
      }
      updated++;
    } else {
      if (useRemote) {
        await addTenantRemote(data);
      } else {
        const id = await addTenant(data);
        if (data.archived) await updateTenant(id, { archived: true });
      }
      success++;
    }
  }

  return { success, total, updated };
}

async function ensureTenant(apartmentNumber, name) {
  const useRemote = isRemoteApp();
  const tenants = useRemote ? await getAllTenantsRemote(true) : await getAllTenants(true);
  const existing = tenants.find(t => String(t.apartmentNumber) === String(apartmentNumber));
  if (existing) return existing;
  const { firstName, lastName } = splitName(name);
  const payload = {
    firstName,
    lastName,
    apartmentNumber: String(apartmentNumber),
    phone: '',
    startDate: '',
    endDate: '',
    rentAmount: 0,
    nationalId: '',
    electricityMeter: '',
    waterMeter: '',
    notes: 'יובא מטבלת הפקדות'
  };
  if (useRemote) {
    return await addTenantRemote(payload);
  }
  const id = await addTenant(payload);
  return { id, apartmentNumber, firstName, lastName };
}

async function importDepositsFromCsv(csvText, accountValue) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 4) throw new Error('פורמט קובץ לא תקין');
  const rows = lines.map(parseCsvLine);

  const apartments = rows[0];
  const names = rows[1];
  const dayRow = rows[2];

  const tenants = await getAllTenants(true);
  const tenantIndex = buildTenantNameIndex(tenants);
  const existingPayments = await getAllPayments();
  const existingSet = new Set(existingPayments.map(p => buildPaymentKey(p.tenantId, p.tenantName, p.apartmentNumber, p.date, p.amount, p.account)));

  let total = 0;
  let success = 0;
  let skipped = 0;

  for (let r = 3; r < rows.length; r++) {
    const monthCell = rows[r][0];
    const parsed = parseMonthYear(monthCell);
    if (!parsed) continue;
    const { month, year } = parsed;

    for (let c = 1; c < rows[r].length; c++) {
      const apt = apartments[c];
      const name = names[c];
      if (!apt && !name) continue;
      const day = parseDay(dayRow[c]) || 1;
      const valueRaw = rows[r][c];
      if (!valueRaw || String(valueRaw).trim() === '') continue;
      const amount = Number(String(valueRaw).replace(/,/g, ''));
      if (Number.isNaN(amount) || amount === 0) continue;

      const tenant = findTenantByName(tenantIndex, name);
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const key = buildPaymentKey(tenant?.id, name, apt, date, amount, accountValue);
      if (existingSet.has(key)) {
        skipped++;
        continue;
      }

      total++;
      await addPayment({
        tenantId: tenant?.id || null,
        tenantName: tenant ? buildTenantName(tenant) : (name || ''),
        apartmentNumber: tenant?.apartmentNumber || apt || '',
        amount,
        method: 'check',
        account: accountValue,
        date,
        notes: 'יובא מטבלת הפקדות'
      });
      existingSet.add(key);
      success++;
    }
  }

  return { success, total, skipped };
}

// Bills (legacy)
async function generateBills(asOfDate) {
  const elecPrice = await getSetting('electricityPrice') ?? 1.5;
  const waterPrice = await getSetting('waterPrice') ?? 6;
  const kvaCon = await getSetting('kvaCon') ?? 0;
  const tenants = await getAllTenants(false);
  const created = [];
  const tx = await getTx('bills', 'readwrite');
  const billStore = tx.objectStore('bills');

  for (const t of tenants) {
    for (const meterType of ['electricity', 'water']) {
      const readings = await getReadingsByTenant(t.id);
      const relevant = readings.filter(r => r.meterType === meterType && new Date(r.date) <= new Date(asOfDate)).slice(-2);
      if (relevant.length < 2) continue;
      const [prev, curr] = relevant;
      const consumption = Number(curr.value) - Number(prev.value);
      let amount = 0;
      if (meterType === 'electricity') {
        // עלות חשמל = (KVA+CON / 4) + (0.65 * הפרש מונים)
        const kvaCost = kvaCon / 4;
        const consumptionCost = Math.max(0, consumption) * 0.65;
        amount = kvaCost + consumptionCost;
      } else {
        // עלות מים = תעריף * הפרש מונים
        amount = Math.max(0, consumption) * waterPrice;
      }
      const bill = { tenantId: t.id, apartmentNumber: t.apartmentNumber, meterType, prevReading: prev.value, prevDate: prev.date, currReading: curr.value, currDate: curr.date, consumption, amount, date: asOfDate, paid: false, createdAt: new Date().toISOString() };
      billStore.add(bill);
      created.push(bill);
    }
  }
  return created;
}

async function getAllBills() {
  const tx = await getTx('bills', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('bills').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function clearAllBills() {
  const tx = await getTx('bills', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('bills').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// Settings
async function getSetting(key) {
  const tx = await getTx('settings', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('settings').get(key);
    r.onsuccess = () => res(r.result?.value ?? null);
    r.onerror = () => rej(r.error);
  });
}

async function setSetting(key, value) {
  const tx = await getTx('settings', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('settings').put({ key, value });
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// CSV Import
async function parseCSVAndImport(csvText, meterType = 'water') {
  const lines = csvText.trim().split('\n');
  const imported = { success: 0, total: 0, skipped: 0 };

  const tenants = await getAllTenants(false);
  const aptToTenant = {};
  tenants.forEach(t => { aptToTenant[t.apartmentNumber] = t.id; });

  for (let apt = 1; apt <= 5; apt++) {
    if (!aptToTenant[String(apt)]) {
      const id = await addTenant({ firstName: 'דייר', lastName: `דירה ${apt}`, apartmentNumber: String(apt), phone: '', startDate: '', endDate: '', rentAmount: 0, nationalId: '', electricityMeter: '', waterMeter: '', notes: 'יובא מ-CSV' });
      aptToTenant[String(apt)] = id;
    }
  }

  const existing = await getAllReadings();
  const existingSet = new Set();
  existing.forEach(r => existingSet.add(`${r.tenantId}-${r.meterType}-${r.date}`));

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (!row[0]) continue;
    const date = row[2];
    if (!date) continue;

    const apartments = [1, 2, 3, 4, 5];
    const valueIndices = [6, 8, 10, 12, 14];

    for (let aIdx = 0; aIdx < apartments.length; aIdx++) {
      const apt = apartments[aIdx];
      const valIdx = valueIndices[aIdx];
      if (valIdx >= row.length) continue;
      const value = row[valIdx];
      if (!value || value.trim() === '') continue;

      const tenantId = aptToTenant[String(apt)];
      if (!tenantId) continue;

      const key = `${tenantId}-${meterType}-${date}`;
      if (existingSet.has(key)) {
        imported.skipped++;
        continue;
      }

      imported.total++;
      try {
        await addReading({ tenantId, meterType, value: Number(value), date });
        imported.success++;
        existingSet.add(key);
      } catch (e) {
        console.error(e);
      }
    }
  }

  return imported;
}

// Monthly bills report
let lastMonthlyReport = null;

function parseMonthValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const ymdMatch = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    if (!year || month < 1 || month > 12) return null;
    return { year, month, normalized: `${year}-${String(month).padStart(2, '0')}` };
  }

  const euMatch = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (euMatch) {
    const month = Number(euMatch[1]);
    const year = Number(euMatch[2]);
    if (!year || month < 1 || month > 12) return null;
    return { year, month, normalized: `${year}-${String(month).padStart(2, '0')}` };
  }

  return null;
}

function formatMonthEu(value) {
  const parsed = parseMonthValue(value);
  if (!parsed) return String(value || '');
  return `${String(parsed.month).padStart(2, '0')}/${parsed.year}`;
}

function isInMonth(dateStr, year, month) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === year && (d.getMonth() + 1) === month;
}

function getMonthFirstReading(readings, year, month) {
  const monthReadings = readings.filter(r => isInMonth(r.date, year, month))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return monthReadings[0] || null;
}

function getClosestBefore(readings, dateStr) {
  const target = new Date(dateStr);
  const before = readings.filter(r => new Date(r.date) < target)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return before[0] || null;
}

function calculateMeterReportFromPair(prevReading, currentReading, unitPrice) {
  if (!prevReading || !currentReading) return null;
  const consumption = Number(currentReading.value) - Number(prevReading.value);
  const cost = Math.max(0, consumption) * unitPrice;
  return {
    startValue: Number(prevReading.value),
    startDate: prevReading.date,
    endValue: Number(currentReading.value),
    endDate: currentReading.date,
    consumption,
    cost
  };
}

function calculateElectricityReportFromPair(prevReading, currentReading, kvaCon) {
  if (!prevReading || !currentReading) return null;
  const consumption = Number(currentReading.value) - Number(prevReading.value);
  // עלות חשמל = (KVA+CON / 4) + (0.65 * הפרש מונים)
  const kvaCost = kvaCon / 4;
  const consumptionCost = Math.max(0, consumption) * 0.65;
  const cost = kvaCost + consumptionCost;
  return {
    startValue: Number(prevReading.value),
    startDate: prevReading.date,
    endValue: Number(currentReading.value),
    endDate: currentReading.date,
    consumption,
    cost
  };
}

async function buildMonthlyReport(monthValue) {
  const parsed = parseMonthValue(monthValue);
  if (!parsed) throw new Error('בחר חודש תקין (MM/YYYY)');
  const { year, month, normalized } = parsed;

  const waterPrice = Number(await getSetting('waterPrice') ?? 0);
  const kvaCon = Number(await getSetting('kvaCon') ?? 0);
  const tenants = await getAllTenants(false);
  const allReadings = await getAllReadings();

  const rows = tenants.map(t => {
    const tenantReadings = allReadings.filter(r => r.tenantId === t.id);
    const waterAll = tenantReadings.filter(r => r.meterType === 'water');
    const elecAll = tenantReadings.filter(r => r.meterType === 'electricity');

    const waterCurrent = getMonthFirstReading(waterAll, year, month);
    const waterPrev = waterCurrent ? getClosestBefore(waterAll, waterCurrent.date) : null;
    const elecCurrent = getMonthFirstReading(elecAll, year, month);
    const elecPrev = elecCurrent ? getClosestBefore(elecAll, elecCurrent.date) : null;

    const waterReport = calculateMeterReportFromPair(waterPrev, waterCurrent, waterPrice);
    const elecReport = calculateElectricityReportFromPair(elecPrev, elecCurrent, kvaCon);

    const total = (waterReport?.cost || 0) + (elecReport?.cost || 0);

    return {
      tenantName: `${t.firstName || ''} ${t.lastName || ''}`.trim(),
      apartment: t.apartmentNumber || '',
      waterMeter: t.waterMeter || '',
      electricMeter: t.electricityMeter || '',
      water: waterReport,
      electric: elecReport,
      total
    };
  });

  return { monthValue: normalized, rows };
}

function renderBillsReport(report) {
  const container = document.getElementById('bills-report');
  if (!container) return;
  if (!report || report.rows.length === 0) {
    container.innerHTML = '<p>אין נתונים להצגה</p>';
    return;
  }

  const header = `<div style="margin-bottom:8px;font-weight:600;">דוח חשבונות לחודש ${formatMonthEu(report.monthValue)}</div>`;

  const tableHeader = `
    <table class="report-table">
      <thead>
        <tr>
          <th>דייר</th>
          <th>דירה</th>
          <th>PDF</th>
          <th>מונה מים</th>
          <th>קריאת מים התחלה</th>
          <th>תאריך התחלה</th>
          <th>קריאת מים סוף</th>
          <th>תאריך סוף</th>
          <th>עלות מים</th>
          <th>מונה חשמל</th>
          <th>קריאת חשמל התחלה</th>
          <th>תאריך התחלה</th>
          <th>קריאת חשמל סוף</th>
          <th>תאריך סוף</th>
          <th>עלות חשמל</th>
          <th>סה"כ</th>
        </tr>
      </thead>
      <tbody>
  `;

  const body = report.rows.map(r => {
    const w = r.water || {};
    const e = r.electric || {};
    return `
      <tr>
        <td>${r.tenantName || '-'}</td>
        <td>${r.apartment || '-'}</td>
        <td><button class="btn-pdf" data-tenant="${r.apartment}">PDF</button></td>
        <td>${r.waterMeter || '-'}</td>
        <td>${w.startValue ?? '-'}</td>
        <td>${formatDateEu(w.startDate ?? '') || '-'}</td>
        <td>${w.endValue ?? '-'}</td>
        <td>${formatDateEu(w.endDate ?? '') || '-'}</td>
        <td>${(w.cost ?? 0).toFixed(2)}</td>
        <td>${r.electricMeter || '-'}</td>
        <td>${e.startValue ?? '-'}</td>
        <td>${formatDateEu(e.startDate ?? '') || '-'}</td>
        <td>${e.endValue ?? '-'}</td>
        <td>${formatDateEu(e.endDate ?? '') || '-'}</td>
        <td>${(e.cost ?? 0).toFixed(2)}</td>
        <td>${(r.total ?? 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `${header}${tableHeader}${body}</tbody></table>`;
}

function reportToCsv(report) {
  const rows = [
    ['דייר', 'דירה', 'מונה מים', 'קריאת מים התחלה', 'תאריך התחלה', 'קריאת מים סוף', 'תאריך סוף', 'עלות מים', 'מונה חשמל', 'קריאת חשמל התחלה', 'תאריך התחלה', 'קריאת חשמל סוף', 'תאריך סוף', 'עלות חשמל', 'סה"כ']
  ];

  report.rows.forEach(r => {
    const w = r.water || {};
    const e = r.electric || {};
    rows.push([
      r.tenantName || '',
      r.apartment || '',
      r.waterMeter || '',
      w.startValue ?? '',
      formatDateEu(w.startDate ?? ''),
      w.endValue ?? '',
      formatDateEu(w.endDate ?? ''),
      (w.cost ?? 0).toFixed(2),
      r.electricMeter || '',
      e.startValue ?? '',
      formatDateEu(e.startDate ?? ''),
      e.endValue ?? '',
      formatDateEu(e.endDate ?? ''),
      (e.cost ?? 0).toFixed(2),
      (r.total ?? 0).toFixed(2)
    ]);
  });

  const escape = v => '"' + String(v).replace(/"/g, '""') + '"';
  return rows.map(row => row.map(escape).join(',')).join('\n');
}

function downloadCsv(content, filename) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildTenantPdfHtml(row, monthValue) {
  const w = row.water || {};
  const e = row.electric || {};
  const total = (row.total ?? 0).toFixed(2);
  return `
    <html lang="he" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>דוח דייר</title>
        <style>
          body{font-family:Arial, sans-serif; direction:rtl; padding:24px;}
          h1{font-size:20px; margin-bottom:8px;}
          table{width:100%; border-collapse:collapse; margin-top:12px;}
          th,td{border:1px solid #ccc; padding:6px; font-size:12px;}
          th{background:#f3f3f3;}
          .section{margin-top:16px;}
        </style>
      </head>
      <body>
        <h1>דוח חשבונות לחודש ${formatMonthEu(monthValue)}</h1>
        <div>דייר: ${row.tenantName || '-'}</div>
        <div>דירה: ${row.apartment || '-'}</div>

        <div class="section">
          <h2>מים</h2>
          <table>
            <tr><th>מונה</th><th>קריאה התחלה</th><th>תאריך התחלה</th><th>קריאה סוף</th><th>תאריך סוף</th><th>עלות</th></tr>
            <tr>
              <td>${row.waterMeter || '-'}</td>
              <td>${w.startValue ?? '-'}</td>
              <td>${formatDateEu(w.startDate ?? '') || '-'}</td>
              <td>${w.endValue ?? '-'}</td>
              <td>${formatDateEu(w.endDate ?? '') || '-'}</td>
              <td>${(w.cost ?? 0).toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <div class="section">
          <h2>חשמל</h2>
          <table>
            <tr><th>מונה</th><th>קריאה התחלה</th><th>תאריך התחלה</th><th>קריאה סוף</th><th>תאריך סוף</th><th>עלות</th></tr>
            <tr>
              <td>${row.electricMeter || '-'}</td>
              <td>${e.startValue ?? '-'}</td>
              <td>${formatDateEu(e.startDate ?? '') || '-'}</td>
              <td>${e.endValue ?? '-'}</td>
              <td>${formatDateEu(e.endDate ?? '') || '-'}</td>
              <td>${(e.cost ?? 0).toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <div class="section"><strong>סה"כ לתשלום: ${total} ₪</strong></div>
      </body>
    </html>
  `;
}

function openPdfWindow(html) {
  const w = window.open('', '_blank');
  if (!w) { alert('חסום חלון קופץ בדפדפן'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

// UI Elements
const tenantList = document.getElementById('tenant-list');
const tenantForm = document.getElementById('tenant-form');
const archiveView = document.getElementById('archive-view');
const readingsView = document.getElementById('readings-view');
const settingsView = document.getElementById('settings-view');
const paymentsView = document.getElementById('payments-view');
const balanceView = document.getElementById('balance-view');
const dashboardView = document.getElementById('dashboard-view');
const confirmModal = document.getElementById('confirm-modal');

// UI Helpers
function hideAll() { [tenantForm, archiveView, readingsView, settingsView, paymentsView, balanceView, dashboardView].forEach(x => x?.classList.add('hidden')); }
function show(el) { hideAll(); el?.classList.remove('hidden'); }
function confirmDialog(msg) {
  return new Promise(res => {
    document.getElementById('confirm-text').textContent = msg;
    confirmModal.classList.remove('hidden');
    const onYes = () => { clean(); res(true); };
    const onNo = () => { clean(); res(false); };
    const clean = () => {
      confirmModal.classList.add('hidden');
      document.getElementById('confirm-yes').removeEventListener('click', onYes);
      document.getElementById('confirm-no').removeEventListener('click', onNo);
    };
    document.getElementById('confirm-yes').addEventListener('click', onYes);
    document.getElementById('confirm-no').addEventListener('click', onNo);
  });
}

function sortTenantsByMeter(tenants, meterKey) {
  return tenants.slice().sort((a, b) => {
    const aVal = Number(a[meterKey]);
    const bVal = Number(b[meterKey]);
    if (Number.isNaN(aVal) && Number.isNaN(bVal)) return 0;
    if (Number.isNaN(aVal)) return 1;
    if (Number.isNaN(bVal)) return -1;
    return aVal - bVal;
  });
}

function buildBulkList(containerId, tenants, meterKey, unitLabel) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  tenants.forEach(t => {
    const meter = t[meterKey] || '';
    const row = document.createElement('div');
    row.className = 'bulk-row';
    row.innerHTML = `
      <div class="bulk-main">
        <div class="bulk-title">דירה ${t.apartmentNumber || '-'} · ${t.firstName || ''} ${t.lastName || ''}</div>
        <div class="bulk-sub">מונה: ${meter || 'לא מוגדר'}</div>
      </div>
      <input class="bulk-value" type="number" step="0.01" data-tenant-id="${t.id}" placeholder="קריאה (${unitLabel})">
    `;
    container.appendChild(row);
  });
}

function buildTenantSelectOptions(tenants, selectedId = '') {
  const options = ['<option value="">בחר דייר</option>'];
  tenants.forEach(t => {
    const name = `${t.firstName || ''} ${t.lastName || ''}`.trim();
    const label = `${t.apartmentNumber || '-'}: ${name || '-'}`;
    const selected = String(t.id) === String(selectedId) ? ' selected' : '';
    options.push(`<option value="${t.id}"${selected}>${label}</option>`);
  });
  return options.join('');
}

async function saveBulkReadings(meterType, dateInputId, listId, statusId) {
  const date = document.getElementById(dateInputId)?.value;
  if (!date) { alert('נא להזין תאריך קריאה'); return; }
  const parsedDate = parseDateToIso(date);
  if (!parsedDate) { alert('תאריך לא תקין'); return; }

  const inputs = Array.from(document.querySelectorAll(`#${listId} input[data-tenant-id]`));
  let total = 0, success = 0, skipped = 0, failed = 0;

  for (const input of inputs) {
    const valueRaw = input.value.trim();
    if (!valueRaw) continue;
    total++;
    const tenantId = Number(input.dataset.tenantId);
    try {
      const payload = { tenantId, meterType, value: Number(valueRaw), date: parsedDate };
      await addReading(payload);
      success++;
      input.value = '';
    } catch (err) {
      if (String(err.message).includes('כבר קיימת')) skipped++; else failed++;
    }
  }

  const statusEl = document.getElementById(statusId);
  if (statusEl) {
    statusEl.textContent = `נשמרו ${success}/${total} | דילוגים: ${skipped} | שגיאות: ${failed}`;
  }

  await renderReadings();
}

// Rendering
async function renderTenants() {
  const tenants = await getAllTenants(false);
  tenantList.innerHTML = tenants.length === 0 ? '<p>אין דיירים</p>' : '';
  tenants.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tenant-item';
    el.innerHTML = `<div><strong>${t.apartmentNumber || '-'}: ${t.firstName} ${t.lastName}</strong><div class="muted">${t.phone || ''}</div></div><div class="actions"><button data-id="${t.id}" class="btn-edit">✏️</button><button data-id="${t.id}" class="btn-archive">📦</button><button data-id="${t.id}" class="btn-delete">🗑️</button></div>`;
    tenantList.appendChild(el);
  });
  await renderTenantsTable();
}

async function renderTenantsTable() {
  const container = document.getElementById('tenants-table');
  if (!container) return;
  const tenants = await getAllTenants(false);
  if (tenants.length === 0) {
    container.innerHTML = '<p>אין דיירים</p>';
    return;
  }

  const rows = tenants.slice().sort((a, b) => Number(a.apartmentNumber || 0) - Number(b.apartmentNumber || 0)).map(t => {
    const rentNum = Number(t.rentAmount);
    const rent = !Number.isNaN(rentNum) && String(t.rentAmount).trim() !== '' ? `₪${rentNum.toFixed(2)}` : '-';
    const arnonaNum = Number(t.arnonaAmount);
    const arnona = !Number.isNaN(arnonaNum) && String(t.arnonaAmount).trim() !== '' ? `₪${arnonaNum.toFixed(2)}` : '-';
    const name = `${t.firstName || ''} ${t.lastName || ''}`.trim();
    const status = t.archived ? 'לא פעיל' : 'פעיל';
    return `
      <tr>
        <td>${t.apartmentNumber || '-'}</td>
        <td>${name || '-'}</td>
        <td>${t.phone || '-'}</td>
        <td>${status}</td>
        <td>${rent}</td>
        <td>${arnona}</td>
        <td>${t.electricityMeter || '-'}</td>
        <td>${t.waterMeter || '-'}</td>
        <td>${formatDateEu(t.startDate || '') || '-'}</td>
        <td>${formatDateEu(t.endDate || '') || '-'}</td>
        <td><input type="text" class="moveout-input" data-id="${t.id}" value="${formatDateEu(t.moveOutDate || '')}" placeholder="DD/MM/YYYY"></td>
        <td>${t.notes || '-'}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th>דירה</th>
          <th>דייר</th>
          <th>טלפון</th>
          <th>סטטוס</th>
          <th>שכירות</th>
          <th>ארנונה</th>
          <th>מונה חשמל</th>
          <th>מונה מים</th>
          <th>תחילת חוזה</th>
          <th>סיום חוזה</th>
          <th>תאריך עזיבה</th>
          <th>הערות</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function renderArchive() {
  const allTenants = await getAllTenants(true);
  const archived = allTenants.filter(t => t.archived);
  const list = document.getElementById('archive-list');
  if (archived.length === 0) {
    list.innerHTML = '<p>אין בארכיון</p>';
    return;
  }

  const rows = archived.slice().sort((a, b) => Number(a.apartmentNumber || 0) - Number(b.apartmentNumber || 0)).map(t => {
    const rentNum = Number(t.rentAmount);
    const rent = !Number.isNaN(rentNum) && String(t.rentAmount).trim() !== '' ? `₪${rentNum.toFixed(2)}` : '-';
    const arnonaNum = Number(t.arnonaAmount);
    const arnona = !Number.isNaN(arnonaNum) && String(t.arnonaAmount).trim() !== '' ? `₪${arnonaNum.toFixed(2)}` : '-';
    const name = `${t.firstName || ''} ${t.lastName || ''}`.trim();
    return `
      <tr>
        <td>${t.apartmentNumber || '-'}</td>
        <td>${name || '-'}</td>
        <td>${t.phone || '-'}</td>
        <td>לא פעיל</td>
        <td>${rent}</td>
        <td>${arnona}</td>
        <td>${t.electricityMeter || '-'}</td>
        <td>${t.waterMeter || '-'}</td>
        <td>${formatDateEu(t.startDate || '') || '-'}</td>
        <td>${formatDateEu(t.endDate || '') || '-'}</td>
        <td><input type="text" class="moveout-input" data-id="${t.id}" value="${formatDateEu(t.moveOutDate || '')}" placeholder="DD/MM/YYYY"></td>
        <td>${t.notes || '-'}</td>
        <td>
          <button data-id="${t.id}" class="btn-restore">↩️</button>
          <button data-id="${t.id}" class="btn-delete">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  list.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th>דירה</th>
          <th>דייר</th>
          <th>טלפון</th>
          <th>סטטוס</th>
          <th>שכירות</th>
          <th>ארנונה</th>
          <th>מונה חשמל</th>
          <th>מונה מים</th>
          <th>תחילת חוזה</th>
          <th>סיום חוזה</th>
          <th>תאריך עזיבה</th>
          <th>הערות</th>
          <th>פעולות</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function renderReadings() {
  const list = document.getElementById('readings-list');
  if (!list) return;
  list.innerHTML = '';

  try {
    const all = await getAllReadings();
    const tenants = await getAllTenants(true);

    if (all.length === 0) { list.innerHTML = '<p>אין קריאות</p>'; return; }

    const tenantMap = new Map(tenants.map(t => [t.id, t]));
    const sorted = all.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    const rows = sorted.map(r => {
      const t = tenantMap.get(r.tenantId);
      const name = t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (r.tenantName || '');
      const apartment = t?.apartmentNumber || r.apartmentNumber || '';
      const missing = !t;
      const linkCell = missing ? `
        <select class="link-reading-select" data-reading-id="${r.id}">
          ${buildTenantSelectOptions(tenants)}
        </select>
      ` : '—';
      return `
        <tr class="${missing ? 'row-missing' : ''}">
          <td>${formatDateEu(r.date)}</td>
          <td>${apartment || '-'}</td>
          <td>${name || '-'}</td>
          <td>${meterTypeLabel(r.meterType)}</td>
          <td>${r.value ?? ''}</td>
          <td>${linkCell}</td>
          <td>
            <button class="btn-edit-reading" data-id="${r.id}">✏️</button>
            <button class="btn-delete-reading" data-id="${r.id}">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    list.innerHTML = `
      <table class="payments-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>דירה</th>
            <th>דייר</th>
            <th>סוג</th>
            <th>ערך</th>
            <th>קישור</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p style="color: #e74c3c;">שגיאה בטעינת קריאות: ${err.message}</p>`;
  }
}

async function renderPayments() {
  const all = await getAllPayments();
  const list = document.getElementById('payments-list');
  if (all.length === 0) {
    list.innerHTML = '<p>אין תשלומים</p>';
    return;
  }

  const tenants = await getAllTenants(true);
  const tenantMap = new Map(tenants.map(t => [t.id, t]));
  const sorted = all.slice();
  if (paymentsSort.key) {
    const dir = paymentsSort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => comparePayments(a, b, tenantMap, paymentsSort.key) * dir);
  } else {
    sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  const rows = sorted.map(p => {
    const t = tenantMap.get(p.tenantId);
    const name = t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (p.tenantName || '');
    const apartment = t?.apartmentNumber || p.apartmentNumber || '';
    const missing = !t;
    const linkCell = missing ? `
      <select class="link-payment-select" data-payment-id="${p.id}">
        ${buildTenantSelectOptions(tenants)}
      </select>
    ` : '—';
    return `
      <tr class="${missing ? 'row-missing' : ''}">
        <td>${formatDateEu(p.date)}</td>
        <td>${apartment || '-'}</td>
        <td>${name || '-'}</td>
        <td>₪${Number(p.amount).toFixed(2)}</td>
        <td>${accountLabel(p.account)}</td>
        <td>${p.method || ''}</td>
        <td>${p.notes || ''}</td>
        <td>${linkCell}</td>
        <td>
          <button class="btn-edit-payment" data-id="${p.id}">✏️</button>
          <button class="btn-delete-payment" data-id="${p.id}">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  list.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th data-key="date">תאריך</th>
          <th data-key="apartment">דירה</th>
          <th data-key="tenant">דייר</th>
          <th data-key="amount">סכום</th>
          <th data-key="account">חשבון</th>
          <th data-key="method">אמצעי</th>
          <th data-key="notes">הערות</th>
          <th>קישור</th>
          <th>פעולות</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function renderBalance() {
  const tenants = await getAllTenants(false);
  const bills = await getAllBills();
  const payments = await getAllPayments();
  const list = document.getElementById('balance-list');
  list.innerHTML = '';

  tenants.forEach(t => {
    const billSum = bills.filter(b => b.tenantId === t.id).reduce((s, x) => s + x.amount, 0);
    const paySum = payments.filter(p => p.tenantId === t.id).reduce((s, x) => s + x.amount, 0);
    const balance = billSum - paySum;
    const el = document.createElement('div');
    el.className = 'tenant-item';
    el.innerHTML = `<div><strong>${t.apartmentNumber || '-'}: ${t.firstName} ${t.lastName}</strong><div class="muted">חשבונות: ₪${billSum.toFixed(2)} | תשלומים: ₪${paySum.toFixed(2)}</div><div style="color:${balance > 0 ? '#e74c3c' : '#27ae60'};font-weight:bold;margin-top:4px;">${balance > 0 ? 'חוב' : 'זכות'}: ₪${Math.abs(balance).toFixed(2)}</div></div>`;
    list.appendChild(el);
  });
}

async function populateTenantSelects() {
  const tenants = await getAllTenants(false);
  [document.getElementById('reading-tenant'), document.getElementById('payment-tenant')].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '<option value="">בחר דייר</option>';
    tenants.forEach(t => { const opt = document.createElement('option'); opt.value = t.id; opt.textContent = `${t.apartmentNumber || '-'}: ${t.firstName}`; sel.appendChild(opt); });
  });
}

const paymentForm = document.getElementById('payment-form');
const paymentSubmitBtn = paymentForm?.querySelector('button[type="submit"]');

function resetPaymentFormMode() {
  if (!paymentForm) return;
  paymentForm.editId = null;
  if (paymentSubmitBtn) paymentSubmitBtn.textContent = 'הכנס';
}

// Expenses functions
async function addExpense(data) {
  const tx = await getTx('expenses', 'readwrite');
  data.createdAt = new Date().toISOString();
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').add(data);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function deleteExpense(id) {
  const tx = await getTx('expenses', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getAllExpenses() {
  const tx = await getTx('expenses', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').getAll();
    r.onsuccess = () => res((r.result || []).sort((a, b) => new Date(b.date) - new Date(a.date)));
    r.onerror = () => rej(r.error);
  });
}

async function renderExpenses() {
  const expenses = await getAllExpenses();
  const listEl = document.getElementById('expenses-list');
  if (expenses.length === 0) {
    listEl.innerHTML = '<p>אין הוצאות</p>';
    return;
  }
  
  let total = 0;
  const typeLabels = {
    arnona1: 'ארנונה 1 (31/1)',
    arnona2: 'ארנונה 2 (31/2)',
    water: 'מים/ביוב',
    electricity: 'חשמל'
  };
  
  const rows = expenses.map(e => {
    total += e.amount || 0;
    const frequency = e.frequency ? ` [${e.frequency === 'yearly' ? 'שנתי' : 'דו-חודשי'}]` : '';
    const dateRange = e.startDate && e.endDate 
      ? `${formatDateEu(e.startDate)} - ${formatDateEu(e.endDate)}`
      : formatDateEu(e.date || '');
    return `
      <tr>
        <td>${dateRange}</td>
        <td>${typeLabels[e.type] || e.type}${frequency}</td>
        <td>₪${(e.amount || 0).toFixed(2)}</td>
        <td><button class="btn-delete-expense" data-id="${e.id}">🗑️</button></td>
      </tr>
    `;
  }).join('');
  
  listEl.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th>טווח תאריכים</th>
          <th>סוג</th>
          <th>סכום</th>
          <th>פעולות</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr style="font-weight: bold; border-top: 2px solid #333;">
          <td colspan="2">סה"כ:</td>
          <td>₪${total.toFixed(2)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `;
}

const expensesView = document.getElementById('expenses-view');

// Actions
const showAddBtn = document.getElementById('show-add');
const showArchiveBtn = document.getElementById('show-archive');
const showSettingsBtn = document.getElementById('show-settings');
const showReadingsBtn = document.getElementById('show-readings');
const showPaymentsBtn = document.getElementById('show-payments');
const showExpensesBtn = document.getElementById('show-expenses');
const showBalanceBtn = document.getElementById('show-balance');

showAddBtn?.addEventListener('click', async () => { show(tenantForm); tenantForm.editId = null; document.getElementById('form-title').textContent = 'הוספת דייר'; tenantForm.reset(); await renderTenantsTable(); });
showArchiveBtn?.addEventListener('click', async () => { await renderArchive(); show(archiveView); });
showSettingsBtn?.addEventListener('click', async () => { 
  const e = await getSetting('electricityPrice'); 
  const w = await getSetting('waterPrice'); 
  const kva = await getSetting('kvaCon');
  const t = await getSetting('appTitle'); 
  const serverUrl = await getSetting('serverUrl');
  document.getElementById('electricity-price').value = e ?? ''; 
  document.getElementById('water-price').value = w ?? ''; 
  document.getElementById('kva-con').value = kva ?? '';
  document.getElementById('app-title').value = t ?? ''; 
  document.getElementById('server-url').value = serverUrl ?? '';
  show(settingsView); 
});
showPaymentsBtn?.addEventListener('click', async () => {
  await populateTenantSelects();
  if (paymentForm) paymentForm.reset();
  resetPaymentFormMode();
  await renderPayments();
  show(paymentsView);
});
showBalanceBtn?.addEventListener('click', async () => { await renderBalance(); show(balanceView); });

showExpensesBtn?.addEventListener('click', async () => { 
  await renderExpenses();
  show(expensesView);
});

showReadingsBtn?.addEventListener('click', async () => {
  const tenants = await getAllTenants(false);
  const sortedElec = sortTenantsByMeter(tenants, 'electricityMeter');
  const sortedWater = sortTenantsByMeter(tenants, 'waterMeter');
  buildBulkList('bulk-electricity-list', sortedElec, 'electricityMeter', 'קוט"ש');
  buildBulkList('bulk-water-list', sortedWater, 'waterMeter', 'מ"ק');
  await renderReadings();
  const monthInput = document.getElementById('bill-month');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    monthInput.value = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  }
  const today = formatDateEu(new Date().toISOString().slice(0, 10));
  const elecDate = document.getElementById('bulk-electricity-date');
  const waterDate = document.getElementById('bulk-water-date');
  if (elecDate && !elecDate.value) elecDate.value = today;
  if (waterDate && !waterDate.value) waterDate.value = today;
  const reportContainer = document.getElementById('bills-report');
  if (reportContainer) reportContainer.innerHTML = '';
  show(readingsView);
});

// Close buttons
document.getElementById('cancel')?.addEventListener('click', () => show(tenantForm));
document.getElementById('close-archive')?.addEventListener('click', () => show(tenantForm));
document.getElementById('cancel-reading')?.addEventListener('click', () => show(tenantForm));
document.getElementById('close-settings')?.addEventListener('click', () => show(tenantForm));
document.getElementById('close-payments')?.addEventListener('click', () => {
  if (paymentForm) paymentForm.reset();
  resetPaymentFormMode();
  show(tenantForm);
});
document.getElementById('close-expenses')?.addEventListener('click', () => show(tenantForm));

// Expenses form
document.getElementById('save-expense')?.addEventListener('click', async () => {
  const startDate = document.getElementById('expense-start-date').value;
  const endDate = document.getElementById('expense-end-date').value;
  const arnona1 = parseFloat(document.getElementById('expense-arnona1').value) || 0;
  const arnona1Freq = document.getElementById('expense-arnona1-frequency').value;
  const arnona2 = parseFloat(document.getElementById('expense-arnona2').value) || 0;
  const arnona2Freq = document.getElementById('expense-arnona2-frequency').value;
  const water = parseFloat(document.getElementById('expense-water').value) || 0;
  const electricity = parseFloat(document.getElementById('expense-electricity').value) || 0;
  
  if (!startDate || !endDate) { alert('הזן תאריך התחלה וסיום'); return; }
  if (arnona1 === 0 && arnona2 === 0 && water === 0 && electricity === 0) { 
    alert('הזן לפחות הוצאה אחת'); 
    return; 
  }
  if (arnona1 > 0 && !arnona1Freq) { 
    alert('בחר תדירות לארנונה 1'); 
    return; 
  }
  if (arnona2 > 0 && !arnona2Freq) { 
    alert('בחר תדירות לארנונה 2'); 
    return; 
  }
  
  const parsedStartDate = parseDateToIso(startDate);
  const parsedEndDate = parseDateToIso(endDate);
  if (!parsedStartDate || !parsedEndDate) { alert('תאריך לא תקין'); return; }
  
  // Save each expense separately
  if (arnona1 > 0) {
    await addExpense({
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      type: 'arnona1',
      amount: arnona1,
      frequency: arnona1Freq
    });
  }
  if (arnona2 > 0) {
    await addExpense({
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      type: 'arnona2',
      amount: arnona2,
      frequency: arnona2Freq
    });
  }
  if (water > 0) {
    await addExpense({
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      type: 'water',
      amount: water
    });
  }
  if (electricity > 0) {
    await addExpense({
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      type: 'electricity',
      amount: electricity
    });
  }
  
  document.getElementById('expense-start-date').value = '';
  document.getElementById('expense-end-date').value = '';
  document.getElementById('expense-arnona1').value = '';
  document.getElementById('expense-arnona1-frequency').value = '';
  document.getElementById('expense-arnona2').value = '';
  document.getElementById('expense-arnona2-frequency').value = '';
  document.getElementById('expense-water').value = '';
  document.getElementById('expense-electricity').value = '';
  
  await renderExpenses();
});

document.getElementById('expenses-list')?.addEventListener('click', async e => {
  const delBtn = e.target.closest('.btn-delete-expense');
  if (!delBtn) return;
  const id = Number(delBtn.dataset.id);
  if (await confirmDialog('מחק את ההוצאה?')) {
    await deleteExpense(id);
    await renderExpenses();
  }
});

// Expenses CSV
document.getElementById('expenses-export-csv')?.addEventListener('click', async () => {
  const expenses = await getAllExpenses();
  const csv = 'StartDate,EndDate,Type,Amount,Frequency\n' + 
    expenses.map(e => `${e.startDate||e.date||''},${e.endDate||e.date||''},${e.type},${e.amount||0},${e.frequency||''}`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'expenses.csv';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('expenses-import-csv')?.addEventListener('click', async () => {
  const file = document.getElementById('expenses-csv-upload').files[0];
  if (!file) { alert('בחר קובץ'); return; }
  const statusEl = document.getElementById('expenses-csv-status');
  if (statusEl) statusEl.textContent = 'מעבד...';
  try {
    const text = await readCsvWithEncoding(file);
    const lines = text.trim().split('\n');
    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 3 && parts[0]) {
        const [startDate, endDate, type, amount, frequency] = parts;
        await addExpense({
          startDate: startDate.trim() || undefined,
          endDate: endDate.trim() || undefined,
          type: type.trim(),
          amount: parseFloat(amount) || 0,
          frequency: frequency ? frequency.trim() : undefined
        });
        imported++;
      }
    }
    if (statusEl) statusEl.textContent = `יובאו ${imported} הוצאות ✓`;
  } catch(err) {
    if (statusEl) statusEl.textContent = `שגיאה: ${err.message}`;
  }
  await renderExpenses();
});

document.getElementById('expenses-clear-all')?.addEventListener('click', async () => {
  if (await confirmDialog('מחק את כל ההוצאות?')) {
    const expenses = await getAllExpenses();
    for (const e of expenses) await deleteExpense(e.id);
    await renderExpenses();
  }
});

// Tenant form
tenantForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const data = {};
  for (const el of f.elements) if (el.name) data[el.name] = el.value;
  const isActive = f.elements['active'] ? f.elements['active'].checked : true;
  data.archived = !isActive;
  if (data.startDate) {
    const parsedStart = parseDateToIso(data.startDate);
    if (!parsedStart) { alert('תאריך התחלה לא תקין'); return; }
    data.startDate = parsedStart;
  }
  if (data.endDate) {
    const parsedEnd = parseDateToIso(data.endDate);
    if (!parsedEnd) { alert('תאריך סיום לא תקין'); return; }
    data.endDate = parsedEnd;
  }
  if (f.editId) await updateTenant(Number(f.editId), data); else await addTenant(data);
  show(tenantForm);
  await renderTenants();
  f.reset();
});

const tenantsExportBtn = document.getElementById('tenants-export-csv');
const tenantsImportBtn = document.getElementById('tenants-import-csv');
const tenantsClearBtn = document.getElementById('tenants-clear-all');

tenantsExportBtn?.addEventListener('click', async () => {
  const statusEl = document.getElementById('tenants-csv-status');
  if (statusEl) statusEl.textContent = 'מייצא...';
  try {
    await exportTenantsCsv();
    if (statusEl) statusEl.textContent = 'קובץ CSV נוצר ✓';
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
});

tenantsImportBtn?.addEventListener('click', async () => {
  const file = document.getElementById('tenants-csv-upload').files[0];
  if (!file) { alert('בחר קובץ'); return; }
  const statusEl = document.getElementById('tenants-csv-status');
  if (statusEl) statusEl.textContent = 'מעבד...';
  try {
    const text = await readCsvWithEncoding(file);
    const res = await importTenantsCsv(text);
    if (statusEl) statusEl.textContent = `יובאו ${res.success}/${res.total} דיירים | עודכנו ${res.updated} ✓`;
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
  await renderTenants();
  await renderArchive();
});

tenantsClearBtn?.addEventListener('click', async () => {
  const confirmed = await confirmDialog('למחוק את כל הדיירים? זה ימחק גם קריאות, תשלומים וחשבונות. פעולה זו לא הפיכה.');
  if (!confirmed) return;
  const statusEl = document.getElementById('tenants-csv-status');
  if (statusEl) statusEl.textContent = 'מוחק...';
  try {
    if (isRemoteApp()) {
      // Remote: delete everything on server in one call
      await apiRequest('/api/tenants', { method: 'DELETE' });
    } else {
      // Local: clear IndexedDB data
      await clearAllReadings();
      await clearAllPayments();
      await clearAllBills();
      await clearAllTenants();
      // Also clear from server (best-effort)
      try {
        await apiRequest('/api/tenants', { method: 'DELETE' });
      } catch (err) {
        console.warn('Failed to delete from server:', err);
      }
    }
    
    if (statusEl) statusEl.textContent = 'כל הדיירים והנתונים נמחקו ✓';
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
  await renderTenants();
  await renderArchive();
  await renderReadings();
  await renderPayments();
  await renderBalance();
});

// Bulk save
document.getElementById('bulk-electricity-save')?.addEventListener('click', async () => {
  await saveBulkReadings('electricity', 'bulk-electricity-date', 'bulk-electricity-list', 'bulk-electricity-status');
});

document.getElementById('bulk-water-save')?.addEventListener('click', async () => {
  await saveBulkReadings('water', 'bulk-water-date', 'bulk-water-list', 'bulk-water-status');
});

// Payments form
paymentForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const tenantId = f.elements['tenantId'].value ? Number(f.elements['tenantId'].value) : null;
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  const payload = {
    tenantId,
    tenantName: tenant ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim() : '',
    apartmentNumber: tenant?.apartmentNumber || '',
    amount: Number(f.elements['amount'].value),
    method: f.elements['method'].value,
    account: f.elements['account'].value,
    date: f.elements['date'].value,
    notes: f.elements['notes'].value || ''
  };

  if (payload.date) {
    const parsedDate = parseDateToIso(payload.date);
    if (!parsedDate) { alert('תאריך לא תקין'); return; }
    payload.date = parsedDate;
  }

  if (f.editId) {
    const existing = await new Promise((res, rej) => {
      getTx('payments', 'readonly').then(tx => {
        const r = tx.objectStore('payments').get(Number(f.editId));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }).catch(rej);
    });
    if (!tenant) {
      payload.tenantName = existing?.tenantName || '';
      payload.apartmentNumber = existing?.apartmentNumber || '';
    }
    await updatePayment(Number(f.editId), payload);
    resetPaymentFormMode();
  } else {
    await addPayment(payload);
  }

  f.reset();
  await renderPayments();
  await renderBalance();
});

const paymentsExportBtn = document.getElementById('payments-export-csv');
const paymentsImportBtn = document.getElementById('payments-import-csv');
const paymentsClearBtn = document.getElementById('payments-clear-all');

paymentsExportBtn?.addEventListener('click', async () => {
  const statusEl = document.getElementById('payments-csv-status');
  if (statusEl) statusEl.textContent = 'מייצא...';
  try {
    await exportPaymentsCsvEnglish();
    if (statusEl) statusEl.textContent = 'קובץ CSV נוצר ✓';
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
});

paymentsImportBtn?.addEventListener('click', async () => {
  const file = document.getElementById('payments-csv-upload').files[0];
  if (!file) { alert('בחר קובץ'); return; }
  const statusEl = document.getElementById('payments-csv-status');
  if (statusEl) statusEl.textContent = 'מעבד...';
  try {
    const text = await readCsvWithEncoding(file);
    const res = await importPaymentsCsvEnglish(text);
    if (statusEl) statusEl.textContent = `יובאו ${res.success}/${res.total} תשלומים (${res.skipped} כפילויות דולגו) ✓`;
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
  await renderPayments();
  await renderBalance();
});

paymentsClearBtn?.addEventListener('click', async () => {
  const confirmed = await confirmDialog('למחוק את כל התשלומים? פעולה זו לא הפיכה.');
  if (!confirmed) return;
  const statusEl = document.getElementById('payments-csv-status');
  if (statusEl) statusEl.textContent = 'מוחק...';
  try {
    await clearAllPayments();
    if (statusEl) statusEl.textContent = 'כל התשלומים נמחקו ✓';
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
  await renderPayments();
  await renderBalance();
});

// Settings
const saveSettingsBtn = document.getElementById('save-settings');
saveSettingsBtn?.addEventListener('click', async () => {
  const e = Number(document.getElementById('electricity-price').value);
  const w = Number(document.getElementById('water-price').value);
  const kva = Number(document.getElementById('kva-con').value);
  const t = document.getElementById('app-title').value || '';
  const serverUrl = document.getElementById('server-url').value.trim();
  
  if (isNaN(e) || isNaN(w) || isNaN(kva)) { alert('הזן מספרים'); return; }
  
  await setSetting('electricityPrice', e);
  await setSetting('waterPrice', w);
  await setSetting('kvaCon', kva);
  await setSetting('appTitle', t);
  await setSetting('serverUrl', serverUrl);
  
  // Update global server URL
  window.CURRENT_SERVER_URL = serverUrl || 'http://localhost:3001';
  
  // Update page title
  const titleElement = document.querySelector('header h1');
  if (titleElement && t) titleElement.textContent = t;
  document.title = t || 'ניהול דיירים — טרומפלדור 31, נהריה';
  
  alert('שמור');
  show(tenantForm);
});

// Manual tenant sync
const syncPushBtn = document.getElementById('sync-tenants-push');
const syncPullBtn = document.getElementById('sync-tenants-pull');
const syncStatusEl = document.getElementById('sync-status');

const TENANT_SYNC_FIELDS = [
  'firstName', 'lastName', 'nationalId', 'phone', 'startDate', 'endDate', 'moveOutDate',
  'rentAmount', 'arnonaAmount', 'apartmentNumber', 'electricityMeter', 'waterMeter',
  'notes', 'archived', 'active'
];

function setSyncStatus(message, isError = false) {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = message;
  syncStatusEl.style.color = isError ? '#e74c3c' : '#27ae60';
}

function normalizeTenantKeyValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function tenantKey(t) {
  return [
    normalizeTenantKeyValue(t.apartmentNumber),
    normalizeTenantKeyValue(t.firstName),
    normalizeTenantKeyValue(t.lastName),
    normalizeTenantKeyValue(t.startDate)
  ].join('|');
}

function tenantValue(field, tenant) {
  const value = tenant?.[field];
  if (value === null || value === undefined) return '';
  if (field === 'archived' || field === 'active') return value ? 'true' : 'false';
  return String(value);
}

function tenantsEqual(local, remote) {
  return TENANT_SYNC_FIELDS.every(field => tenantValue(field, local) === tenantValue(field, remote));
}

function buildTenantDiffs(local, remote) {
  return TENANT_SYNC_FIELDS
    .map(field => ({
      field,
      local: tenantValue(field, local),
      remote: tenantValue(field, remote)
    }))
    .filter(item => item.local !== item.remote);
}

let pendingTenantConflicts = [];
let resolveTenantConflictsPromise = null;

function renderTenantConflicts() {
  const list = document.getElementById('sync-conflict-list');
  if (!list) return;
  if (pendingTenantConflicts.length === 0) {
    list.innerHTML = '<p style="color:#666;">אין התנגשויות פתוחות.</p>';
    return;
  }

  list.innerHTML = pendingTenantConflicts.map((conflict, index) => {
    const name = `${conflict.local.firstName || ''} ${conflict.local.lastName || ''}`.trim();
    const title = `דירה ${conflict.local.apartmentNumber || '-'} - ${name || 'ללא שם'}`;
    const diffs = conflict.diffs.map(diff => `
      <div class="sync-diff-row">
        <div class="sync-diff-field">${diff.field}</div>
        <div class="sync-diff-value">${diff.local || '-'}</div>
        <div class="sync-diff-value">${diff.remote || '-'}</div>
      </div>
    `).join('');

    return `
      <div class="sync-conflict-item">
        <div class="sync-conflict-title">${title}</div>
        <div class="sync-diff-grid">
          <div class="sync-diff-row sync-diff-header">
            <div class="sync-diff-field">שדה</div>
            <div class="sync-diff-value">מקומי</div>
            <div class="sync-diff-value">שרת</div>
          </div>
          ${diffs}
        </div>
        <div class="sync-conflict-actions">
          <button class="sync-choice-local" data-index="${index}" data-choice="local">השאר מקומי</button>
          <button class="sync-choice-server" data-index="${index}" data-choice="server">החלף מהשרת</button>
        </div>
      </div>
    `;
  }).join('');
}

function openTenantConflictModal(conflicts) {
  pendingTenantConflicts = conflicts;
  renderTenantConflicts();
  const modal = document.getElementById('sync-conflict-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function closeTenantConflictModal() {
  const modal = document.getElementById('sync-conflict-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function resolveTenantConflicts(conflicts) {
  return new Promise(resolve => {
    resolveTenantConflictsPromise = resolve;
    openTenantConflictModal(conflicts);
  });
}

document.getElementById('sync-conflict-close')?.addEventListener('click', () => {
  closeTenantConflictModal();
  if (resolveTenantConflictsPromise) {
    resolveTenantConflictsPromise();
    resolveTenantConflictsPromise = null;
  }
});

document.getElementById('sync-conflict-list')?.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-choice]');
  if (!btn) return;
  const index = Number(btn.dataset.index);
  const choice = btn.dataset.choice;
  const conflict = pendingTenantConflicts[index];
  if (!conflict) return;

  try {
    if (choice === 'local') {
      await updateTenantRemote(conflict.remote.id, conflict.local);
    } else {
      await updateTenant(conflict.local.id, extractTenantFields(conflict.remote));
    }
  } catch (err) {
    alert(`שגיאה בסנכרון: ${err.message}`);
    return;
  }

  pendingTenantConflicts.splice(index, 1);
  if (pendingTenantConflicts.length === 0) {
    closeTenantConflictModal();
    if (resolveTenantConflictsPromise) {
      resolveTenantConflictsPromise();
      resolveTenantConflictsPromise = null;
    }
  } else {
    renderTenantConflicts();
  }
});

async function syncTenantsPush() {
  try {
    setSyncStatus('מסנכרן לשרת...');
    const local = await getAllTenants(true);
    const remote = await getAllTenantsRemote(true);
    const remoteByKey = new Map(remote.map(t => [tenantKey(t), t]));
    const conflicts = [];

    for (const t of local) {
      const key = tenantKey(t);
      const remoteTenant = remoteByKey.get(key);
      if (!remoteTenant) {
        await addTenantRemote(t);
      } else if (!tenantsEqual(t, remoteTenant)) {
        conflicts.push({ local: t, remote: remoteTenant, diffs: buildTenantDiffs(t, remoteTenant) });
      }
    }

    if (conflicts.length > 0) {
      setSyncStatus('נמצאו התנגשויות, יש לבחור עבור כל דייר.');
      await resolveTenantConflicts(conflicts);
    }

    setSyncStatus('סנכרון לשרת הושלם ✓');
  } catch (err) {
    setSyncStatus(`שגיאה בסנכרון: ${err.message}`, true);
  }
}

async function syncTenantsPull() {
  try {
    setSyncStatus('מושך מהשרת...');
    const local = await getAllTenants(true);
    const remote = await getAllTenantsRemote(true);
    const localByKey = new Map(local.map(t => [tenantKey(t), t]));
    const conflicts = [];

    for (const r of remote) {
      const key = tenantKey(r);
      const localTenant = localByKey.get(key);
      if (!localTenant) {
        await addTenant(extractTenantFields(r));
      } else if (!tenantsEqual(localTenant, r)) {
        conflicts.push({ local: localTenant, remote: r, diffs: buildTenantDiffs(localTenant, r) });
      }
    }

    if (conflicts.length > 0) {
      setSyncStatus('נמצאו התנגשויות, יש לבחור עבור כל דייר.');
      await resolveTenantConflicts(conflicts);
    }

    await renderTenants();
    await renderArchive();
    setSyncStatus('משיכה מהשרת הושלמה ✓');
  } catch (err) {
    setSyncStatus(`שגיאה במשיכה: ${err.message}`, true);
  }
}

syncPushBtn?.addEventListener('click', async () => {
  await syncTenantsPush();
});

syncPullBtn?.addEventListener('click', async () => {
  await syncTenantsPull();
});


// Bills actions
const generateBillsBtn = document.getElementById('generate-bills');
generateBillsBtn?.addEventListener('click', async () => {
  try {
    const monthValue = document.getElementById('bill-month')?.value;
    const report = await buildMonthlyReport(monthValue);
    lastMonthlyReport = report;
    renderBillsReport(report);
  } catch (err) {
    alert(`שגיאה: ${err.message}`);
  }
});

document.getElementById('export-bills-report')?.addEventListener('click', async () => {
  try {
    const monthValue = document.getElementById('bill-month')?.value;
    const normalized = parseMonthValue(monthValue)?.normalized || '';
    if (!lastMonthlyReport || lastMonthlyReport.monthValue !== normalized) {
      lastMonthlyReport = await buildMonthlyReport(monthValue);
    }
    const csv = reportToCsv(lastMonthlyReport);
    downloadCsv(csv, `bills_${lastMonthlyReport.monthValue}.csv`);
  } catch (err) {
    alert(`שגיאה: ${err.message}`);
  }
});

const readingsExportBtn = document.getElementById('readings-export-csv');
const readingsImportBtn = document.getElementById('readings-import-csv');
const readingsClearBtn = document.getElementById('readings-clear-all');

readingsExportBtn?.addEventListener('click', async () => {
  const statusEl = document.getElementById('readings-csv-status');
  if (statusEl) statusEl.textContent = 'מייצא...';
  try {
    await exportReadingsCsv();
    if (statusEl) statusEl.textContent = 'קובץ CSV נוצר ✓';
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
});

readingsImportBtn?.addEventListener('click', async () => {
  const file = document.getElementById('readings-csv-upload').files[0];
  if (!file) { alert('בחר קובץ'); return; }
  const statusEl = document.getElementById('readings-csv-status');
  if (statusEl) statusEl.textContent = 'מעבד...';
  try {
    const text = await readCsvWithEncoding(file);
    const res = await importReadingsCsv(text);
    if (statusEl) statusEl.textContent = `יובאו ${res.success}/${res.total} קריאות (${res.skipped} כפילויות דולגו) ✓`;
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
  await renderReadings();
});

readingsClearBtn?.addEventListener('click', async () => {
  const confirmed = await confirmDialog('למחוק את כל הקריאות? פעולה זו לא הפיכה.');
  if (!confirmed) return;
  const statusEl = document.getElementById('readings-csv-status');
  if (statusEl) statusEl.textContent = 'מוחק...';
  try {
    await clearAllReadings();
    if (statusEl) statusEl.textContent = 'כל הקריאות נמחקו ✓';
  } catch (e) {
    if (statusEl) statusEl.textContent = `שגיאה: ${e.message}`;
  }
  await renderReadings();
});

document.getElementById('bills-report')?.addEventListener('click', e => {
  const btn = e.target.closest('.btn-pdf');
  if (!btn || !lastMonthlyReport) return;
  const apartment = btn.dataset.tenant;
  const row = lastMonthlyReport.rows.find(r => String(r.apartment) === String(apartment));
  if (!row) { alert('לא נמצא דייר'); return; }
  const html = buildTenantPdfHtml(row, lastMonthlyReport.monthValue);
  openPdfWindow(html);
});

// Reading edit/delete handlers (delegated)
document.getElementById('readings-list')?.addEventListener('click', async e => {
  const editBtn = e.target.closest('.btn-edit-reading');
  const delBtn = e.target.closest('.btn-delete-reading');
  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    try {
      const rec = await new Promise((res, rej) => {
        getTx('readings', 'readonly').then(tx => {
          const r = tx.objectStore('readings').get(id);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }).catch(rej);
      });
      if (!rec) return alert('לא נמצא רישום');
      const newVal = prompt('ערוך ערך קריאה (ללא יחידות):', String(rec.value));
      if (newVal === null) return;
      const newDate = prompt('ערוך תאריך (DD/MM/YYYY):', formatDateEu(rec.date));
      if (newDate === null) return;
      const parsedDate = parseDateToIso(newDate);
      if (!parsedDate) return alert('תאריך לא תקין');
      await updateReading(id, { value: Number(newVal), date: parsedDate });
      await renderReadings();
      alert('קריאה עודכנה');
    } catch (err) { console.error(err); alert('שגיאה בעדכון: ' + err.message); }
    return;
  }
  if (delBtn) {
    const id = Number(delBtn.dataset.id);
    if (await confirmDialog('להסיר קריאה זו?')) {
      try {
        await deleteReading(id);
        await renderReadings();
        alert('נמחק');
      } catch (err) { console.error(err); alert('שגיאה במחיקה: ' + err.message); }
    }
  }
});

document.getElementById('readings-list')?.addEventListener('change', async e => {
  const select = e.target.closest('.link-reading-select');
  if (!select) return;
  const tenantId = Number(select.value);
  if (!tenantId) return;
  const readingId = Number(select.dataset.readingId);
  const tenant = await getTenantById(tenantId);
  if (!tenant) return;
  const patch = {
    tenantId: tenant.id,
    tenantName: `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim(),
    apartmentNumber: tenant.apartmentNumber || ''
  };
  await updateReading(readingId, patch);
  await renderReadings();
});

// Payments header double-click sort
document.getElementById('payments-list')?.addEventListener('dblclick', async e => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  const key = th.dataset.key;
  if (paymentsSort.key === key) {
    paymentsSort.dir = paymentsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    paymentsSort.key = key;
    paymentsSort.dir = 'asc';
  }
  await renderPayments();
});

async function exportReadingsCsv() {
  const readings = await getAllReadings();
  const tenants = await getAllTenants(true);
  const tenantMap = new Map(tenants.map(t => [t.id, t]));
  const rows = [
    ['date', 'apartment', 'tenant', 'meter_type', 'meter_number', 'value']
  ];

  readings.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(r => {
    const t = tenantMap.get(r.tenantId) || {};
    const name = t.id ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (r.tenantName || '');
    const apartment = t.id ? (t.apartmentNumber || '') : (r.apartmentNumber || '');
    const meterNumber = r.meterType === 'electricity' ? (t.electricityMeter || '') : (t.waterMeter || '');
    rows.push([
      r.date || '',
      apartment,
      name,
      meterTypeLabel(r.meterType),
      meterNumber,
      r.value ?? ''
    ]);
  });

  const csv = rows.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  downloadCsv(csv, 'readings.csv');
}

async function importReadingsCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('קובץ ריק');
  const rows = lines.map(parseCsvLine);

  const startIdx = rows[0][0]?.toLowerCase() === 'date' ? 1 : 0;
  const existing = await getAllReadings();
  const existingSet = new Set(existing.map(r => `${r.tenantId}|${r.meterType}|${r.date}`));
  const tenants = await getAllTenants(true);
  const tenantIndex = buildTenantNameIndex(tenants);

  let total = 0, success = 0, skipped = 0;

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const date = row[0]?.trim();
    const apartment = row[1]?.trim();
    const tenantName = row[2]?.trim();
    const meterType = meterTypeFromCsv(row[3]);
    const meterNumber = row[4]?.trim();
    const value = Number(String(row[5] || '').replace(/,/g, ''));

    if (!date || !apartment || !meterType || Number.isNaN(value)) continue;
    total++;
    const tenant = findTenantByName(tenantIndex, tenantName);
    const key = `${tenant?.id || ''}|${meterType}|${date}`;
    if (existingSet.has(key)) { skipped++; continue; }

    const readingPayload = {
      tenantId: tenant?.id || null,
      meterType,
      value,
      date,
      tenantName: tenant ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim() : (tenantName || ''),
      apartmentNumber: tenant?.apartmentNumber || apartment || ''
    };
    await addReading(readingPayload);
    existingSet.add(key);
    success++;
  }

  return { success, total, skipped };
}

async function exportPaymentsCsvEnglish() {
  const payments = await getAllPayments();
  const tenants = await getAllTenants(true);
  const tenantMap = new Map(tenants.map(t => [t.id, t]));
  const rows = [
    ['date', 'apartment', 'first_name', 'last_name', 'amount', 'account', 'method', 'notes']
  ];

  payments.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(p => {
    const t = tenantMap.get(p.tenantId) || {};
    const name = t.id ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (p.tenantName || '');
    const nameParts = splitName(name);
    const apartment = t.id ? (t.apartmentNumber || '') : (p.apartmentNumber || '');
    rows.push([
      p.date || '',
      apartment,
      nameParts.firstName || '',
      nameParts.lastName || '',
      Number(p.amount).toFixed(2),
      accountLabel(p.account),
      methodLabel(p.method),
      p.notes || ''
    ]);
  });

  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  downloadCsv(csv, 'payments_english.csv');
}

async function importPaymentsCsvEnglish(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('קובץ ריק');
  const rows = lines.map(parseCsvLine);

  // skip header if present
  const startIdx = rows[0][0]?.toLowerCase() === 'date' ? 1 : 0;
  const headerMap = {};
  if (startIdx === 1) {
    rows[0].forEach((h, i) => { headerMap[String(h || '').trim().toLowerCase()] = i; });
  }
  const idx = (name, fallback) => (headerMap[name] === undefined ? fallback : headerMap[name]);

  const tenants = await getAllTenants(true);
  const tenantIndex = buildTenantNameIndex(tenants);

  const existingPayments = await getAllPayments();
  const existingSet = new Set(existingPayments.map(p => buildPaymentKey(p.tenantId, p.tenantName, p.apartmentNumber, p.date, p.amount, p.account)));

  let total = 0, success = 0, skipped = 0;

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const date = row[idx('date', 0)]?.trim();
    const apartment = row[idx('apartment', 1)]?.trim();
    const firstName = row[idx('first_name', 2)]?.trim();
    const lastName = row[idx('last_name', 3)]?.trim();
    const legacyName = row[idx('tenant', 2)]?.trim();
    const tenantName = `${firstName || ''} ${lastName || ''}`.trim() || legacyName || '';
    const amount = Number(String(row[idx('amount', 4)] || '').replace(/,/g, ''));
    const account = accountValueFromCsv(row[idx('account', 5)]);
    const method = methodValueFromCsv(row[idx('method', 6)]);
    const notes = row[idx('notes', 7)]?.trim() || '';

    if (!date || Number.isNaN(amount)) continue;
    total++;
    const tenant = findTenantByName(tenantIndex, tenantName);
    const key = buildPaymentKey(tenant?.id, tenantName, apartment, date, amount, account);
    if (existingSet.has(key)) { skipped++; continue; }

    await addPayment({
      tenantId: tenant?.id || null,
      tenantName: tenant ? buildTenantName(tenant) : (tenantName || ''),
      apartmentNumber: tenant?.apartmentNumber || apartment || '',
      amount,
      method,
      account,
      date,
      notes
    });
    existingSet.add(key);
    success++;
  }

  return { success, total, skipped };
}

// Payments edit/delete handlers
document.getElementById('payments-list')?.addEventListener('click', async e => {
  const editBtn = e.target.closest('.btn-edit-payment');
  const delBtn = e.target.closest('.btn-delete-payment');
  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    try {
      const tx = await getTx('payments', 'readonly');
      const rec = await new Promise((res, rej) => {
        const r = tx.objectStore('payments').get(id);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      if (!rec) return alert('לא נמצא רישום');

      await populateTenantSelects();
      if (!paymentForm) return;
      paymentForm.editId = rec.id;
      if (paymentSubmitBtn) paymentSubmitBtn.textContent = 'עדכן';

      paymentForm.elements['tenantId'].value = rec.tenantId ? String(rec.tenantId) : '';
      paymentForm.elements['amount'].value = Number(rec.amount || 0);
      paymentForm.elements['method'].value = rec.method || 'cash';
      paymentForm.elements['account'].value = rec.account || 'my';
      paymentForm.elements['date'].value = formatDateEu(rec.date || '');
      paymentForm.elements['notes'].value = rec.notes || '';
    } catch (err) {
      console.error(err);
      alert('שגיאה בעדכון: ' + err.message);
    }
  }
  if (delBtn) {
    const id = Number(delBtn.dataset.id);
    if (await confirmDialog('להסיר הפקדה זו?')) {
      try {
        await deletePayment(id);
        await renderPayments();
        await renderBalance();
        alert('הפקדה נמחקה');
      } catch (err) {
        console.error(err);
        alert('שגיאה במחיקה: ' + err.message);
      }
    }
  }
});

document.getElementById('payments-list')?.addEventListener('change', async e => {
  const select = e.target.closest('.link-payment-select');
  if (!select) return;
  const tenantId = Number(select.value);
  if (!tenantId) return;
  const paymentId = Number(select.dataset.paymentId);
  const tenant = isRemoteApp()
    ? await getTenantByIdRemote(tenantId)
    : await getTenantById(tenantId);
  if (!tenant) return;
  await updatePayment(paymentId, {
    tenantId: tenant.id,
    tenantName: `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim(),
    apartmentNumber: tenant.apartmentNumber || ''
  });
  await renderPayments();
  await renderBalance();
});

// Tenant list handlers
tenantList?.addEventListener('click', async e => {
  const editBtn = e.target.closest('.btn-edit');
  const archiveBtn = e.target.closest('.btn-archive');
  const deleteBtn = e.target.closest('.btn-delete');
  
  const id = Number(editBtn?.dataset.id || archiveBtn?.dataset.id || deleteBtn?.dataset.id);
  if (!id) return;
  
  if (editBtn) {
    const tx = await getTx('tenants', 'readonly');
    const store = tx.objectStore('tenants');
    const rec = await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tenant = rec;
    show(tenantForm);
    tenantForm.editId = tenant.id;
    document.getElementById('form-title').textContent = 'ערוך דייר';
    for (const k of ['firstName', 'lastName', 'nationalId', 'phone', 'rentAmount', 'arnonaAmount', 'apartmentNumber', 'electricityMeter', 'waterMeter', 'notes'])
      tenantForm.elements[k].value = tenant[k] || '';
    tenantForm.elements['startDate'].value = formatDateEu(tenant.startDate || '');
    tenantForm.elements['endDate'].value = formatDateEu(tenant.endDate || '');
    if (tenantForm.elements['active']) tenantForm.elements['active'].checked = !tenant.archived;
    return;
  }
  if (archiveBtn) { await updateTenant(id, { archived: true }); await renderTenants(); }
  if (deleteBtn) { if (await confirmDialog('מחק?')) { await detachTenantData(id); await deleteTenant(id); await renderTenants(); } }
});

// Archive list handlers
document.getElementById('archive-list')?.addEventListener('click', async e => {
  const restoreBtn = e.target.closest('.btn-restore');
  const deleteBtn = e.target.closest('.btn-delete');
  
  const id = Number(restoreBtn?.dataset.id || deleteBtn?.dataset.id);
  if (!id) return;
  
  if (restoreBtn) { await updateTenant(id, { archived: false }); await renderArchive(); await renderTenants(); }
  if (deleteBtn) { if (await confirmDialog('מחק לצמיתות?')) { await detachTenantData(id); await deleteTenant(id); await renderArchive(); } }
});

document.getElementById('archive-list')?.addEventListener('change', async e => {
  const input = e.target.closest('.moveout-input');
  if (!input) return;
  const id = Number(input.dataset.id);
  if (!id) return;
  const raw = input.value.trim();
  if (!raw) {
    await updateTenant(id, { moveOutDate: null });
    return;
  }
  const parsedDate = parseDateToIso(raw);
  if (!parsedDate) { alert('תאריך עזיבה לא תקין'); return; }
  await updateTenant(id, { moveOutDate: parsedDate });
});

document.getElementById('tenants-table')?.addEventListener('change', async e => {
  const input = e.target.closest('.moveout-input');
  if (!input) return;
  const id = Number(input.dataset.id);
  if (!id) return;
  const raw = input.value.trim();
  if (!raw) {
    await updateTenant(id, { moveOutDate: null });
    return;
  }
  const parsedDate = parseDateToIso(raw);
  if (!parsedDate) { alert('תאריך עזיבה לא תקין'); return; }
  await updateTenant(id, { moveOutDate: parsedDate });
});

document.getElementById('tenants-table')?.addEventListener('change', async e => {
  const input = e.target.closest('.moveout-input');
  if (!input) return;
  const id = Number(input.dataset.id);
  if (!id) return;
  const raw = input.value.trim();
  if (!raw) {
    await updateTenant(id, { moveOutDate: null });
    return;
  }
  const parsedDate = parseDateToIso(raw);
  if (!parsedDate) { alert('תאריך עזיבה לא תקין'); return; }
  await updateTenant(id, { moveOutDate: parsedDate });
});

// Helper function to parse YYYY-MM-DD strings safely
function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  // Parse as UTC to avoid timezone issues
  return new Date(Date.UTC(year, month - 1, day));
}

// Helper to normalize various date formats to YYYY-MM-DD
function normalizeDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';
  
  console.log('[normalizeDateString] Input:', trimmed);
  
  // Check if it looks like YYYY-MM-DD format
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const year = parseInt(y);
    const month = parseInt(m);
    const day = parseInt(d);
    
    // Validate: month must be 1-12, day must be 1-31
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // Valid date
      const result = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      console.log('[normalizeDateString] Already valid YYYY-MM-DD:', result);
      return result;
    } else {
      // Invalid date! Month or day out of range
      // Likely swapped: YYYY-DD-MM instead of YYYY-MM-DD
      console.log(`[normalizeDateString] Invalid YYYY-MM-DD detected (month=${month}, day=${day}), swapping...`);
      if (day >= 1 && day <= 12 && month >= 1 && month <= 31) {
        // Swap month and day
        const result = `${y}-${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
        console.log(`[normalizeDateString] Fixed by swapping: ${trimmed} → ${result}`);
        return result;
      }
      console.log('[normalizeDateString] Cannot fix, returning as-is');
      return trimmed;
    }
  }
  
  // DD/MM/YYYY or MM/DD/YYYY format (with /, -, or .)
  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (slashMatch) {
    let [, first, second, year] = slashMatch;
    if (year.length === 2) year = '20' + year;
    const f = parseInt(first);
    const s = parseInt(second);
    const y = parseInt(year);
    
    let day, month;
    
    // Logic: if a number is > 12, it MUST be a day (not month)
    if (f > 12) {
      // First number > 12 → must be day → format is DD/MM
      day = f;
      month = s;
    } else if (s > 12) {
      // Second number > 12 → must be day → format is MM/DD
      month = f;
      day = s;
    } else {
      // Both <= 12 (ambiguous) → assume Israeli format DD/MM
      day = f;
      month = s;
    }
    
    const result = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    console.log(`[normalizeDateString] Converted ${trimmed} → ${result} (day=${day}, month=${month})`);
    return result;
  }
  
  console.log('[normalizeDateString] No match, returning as-is:', trimmed);
  return trimmed;
}

// Dashboard
async function renderDashboard() {
  const container = document.getElementById('dashboard-view');
  if (!container) return;

  try {
    // Render income summary
    await renderIncomeSummary();
    
    // Render timeline
    await renderTimeline();
  } catch (err) {
    console.error('Dashboard render error:', err);
    const incomeSummary = document.getElementById('income-summary');
    const timelineContainer = document.getElementById('timeline-container');
    if (incomeSummary) incomeSummary.innerHTML = `<p style="color: red;">שגיאה: ${err.message}</p>`;
    if (timelineContainer) timelineContainer.innerHTML = `<p style="color: red;">שגיאה: ${err.message}</p>`;
  }
}

async function exportTimelineCSV() {
  const tenants = await getAllTenants(true);
  
  if (tenants.length === 0) {
    alert('אין דיירים לייצוא');
    return;
  }

  // Group by apartment
  const byApartment = {};
  tenants.forEach(t => {
    const apt = t.apartmentNumber || 'ללא מספר';
    if (!byApartment[apt]) byApartment[apt] = [];
    byApartment[apt].push(t);
  });

  // Sort apartments
  const apartmentsSorted = Object.keys(byApartment).sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    if (Number.isNaN(aNum) && Number.isNaN(bNum)) return a.localeCompare(b);
    if (Number.isNaN(aNum)) return 1;
    if (Number.isNaN(bNum)) return -1;
    return aNum - bNum;
  });

  // Build CSV
  const rows = [['דירה', 'שם דייר', 'תאריך התחלה', 'תאריך סיום', 'חודשים מושכרים']];

  apartmentsSorted.forEach(apt => {
    byApartment[apt].forEach(tenant => {
      if (!tenant.startDate) return; // Skip tenants without start date

      const name = `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim();
      const startDate = parseDate(tenant.startDate);
      const endDate = parseDate(tenant.moveOutDate || tenant.endDate);
      
      if (!startDate) return;

      // Calculate months
      const months = [];
      let current = new Date(startDate.getFullYear(), startDate.getUTCMonth(), 1);
      const end = endDate || new Date(); // If no end date, use today

      while (current <= end) {
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        months.push(`${year}-${month}`);
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      }

      const endStr = tenant.moveOutDate || tenant.endDate || 'עד היום';
      rows.push([
        apt,
        name,
        formatDateEu(tenant.startDate),
        endStr === 'עד היום' ? endStr : formatDateEu(endStr),
        months.join(', ')
      ]);
    });
  });

  // Convert to CSV
  const csv = rows.map(row => 
    row.map(cell => {
      const cellStr = String(cell || '');
      return '"' + cellStr.replace(/"/g, '""') + '"';
    }).join(',')
  ).join('\n');

  downloadCsv(csv, `timeline_${new Date().toISOString().slice(0, 10)}.csv`);
  alert('קובץ ייצא בהצלחה!');
}

async function fixAllTenantDates() {
  try {
    const tenants = await getAllTenants(true);
    let fixed = 0;
    let alreadyOk = 0;
    
    console.log(`[fixAllTenantDates] Starting with ${tenants.length} tenants`);
    
    for (const tenant of tenants) {
      let needsUpdate = false;
      const updates = {};
      
      console.log(`\n[fixAllTenantDates] Checking tenant: ${tenant.firstName} ${tenant.lastName} (#${tenant.id})`);
      console.log('  startDate:', tenant.startDate);
      console.log('  endDate:', tenant.endDate);
      console.log('  moveOutDate:', tenant.moveOutDate);
      
      // Check and fix startDate
      if (tenant.startDate) {
        const normalized = normalizeDateString(tenant.startDate);
        if (normalized !== tenant.startDate) {
          updates.startDate = normalized;
          needsUpdate = true;
          console.log(`  ✓ Fixing startDate: ${tenant.startDate} → ${normalized}`);
        }
      }
      
      // Check and fix endDate
      if (tenant.endDate) {
        const normalized = normalizeDateString(tenant.endDate);
        if (normalized !== tenant.endDate) {
          updates.endDate = normalized;
          needsUpdate = true;
          console.log(`  ✓ Fixing endDate: ${tenant.endDate} → ${normalized}`);
        }
      }
      
      // Check and fix moveOutDate
      if (tenant.moveOutDate) {
        const normalized = normalizeDateString(tenant.moveOutDate);
        if (normalized !== tenant.moveOutDate) {
          updates.moveOutDate = normalized;
          needsUpdate = true;
          console.log(`  ✓ Fixing moveOutDate: ${tenant.moveOutDate} → ${normalized}`);
        }
      }
      
      if (needsUpdate) {
        console.log('  → Updating tenant with:', updates);
        await updateTenant(tenant.id, updates);
        fixed++;
      } else {
        console.log('  → No changes needed');
        alreadyOk++;
      }
    }
    
    console.log(`\n[fixAllTenantDates] Complete: ${fixed} fixed, ${alreadyOk} already OK`);
    
    await renderDashboard();
    alert(`סיים לתקן תאריכים!\n\nתוקנו: ${fixed} דיירים\nכבר תקינים: ${alreadyOk} דיירים\nסה"כ: ${tenants.length} דיירים\n\nעיין ב-Console (F12) לפרטים נוספים`);
  } catch (err) {
    console.error('Error fixing dates:', err);
    alert('שגיאה בתיקון תאריכים: ' + err.message);
  }
}

async function addSampleTenants() {
  try {
    const today = new Date();
    const samples = [
      {
        firstName: 'דוד',
        lastName: 'כהן',
        apartmentNumber: '1',
        nationId: '123456789',
        phone: '050-1234567',
        startDate: '2024-01-15',
        rentAmount: 3000,
        arnonaAmount: 500
      },
      {
        firstName: 'שרה',
        lastName: 'לוי',
        apartmentNumber: '2',
        nationId: '987654321',
        phone: '050-7654321',
        startDate: '2023-06-01',
        endDate: '2024-06-01',
        rentAmount: 2500,
        arnonaAmount: 400
      },
      {
        firstName: 'אברהם',
        lastName: 'דויד',
        apartmentNumber: '3',
        nationId: '112233445',
        phone: '050-2223334',
        startDate: '2025-03-01',
        rentAmount: 3500,
        arnonaAmount: 600
      }
    ];

    for (const tenant of samples) {
      await addTenant(tenant);
    }

    await renderDashboard();
    alert('נוספו 3 דיירים לדוגמא!');
  } catch (err) {
    console.error('Error adding samples:', err);
    alert('שגיאה בהוספת דוגמאות: ' + err.message);
  }
}

async function renderIncomeSummary() {
  const payments = await getAllPayments();
  const container = document.getElementById('income-summary');
  if (!container) return;

  // Group payments by account
  const byAccount = {
    my: payments.filter(p => p.account === 'my').reduce((sum, p) => sum + Number(p.amount), 0),
    grandma: payments.filter(p => p.account === 'grandma').reduce((sum, p) => sum + Number(p.amount), 0)
  };

  const cards = [
    { account: 'my', label: 'ניר וליאור', amount: byAccount.my },
    { account: 'grandma', label: 'אסתר ומיכאל', amount: byAccount.grandma }
  ];

  if (payments.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; grid-column: 1/-1;">אין תשלומים עדיין</p>';
    return;
  }

  container.innerHTML = cards.map(card => `
    <div class="income-card">
      <h4>${card.label}</h4>
      <div class="amount">₪${card.amount.toFixed(2)}</div>
    </div>
  `).join('');
}

async function renderTimeline() {
  const tenants = await getAllTenants(true);
  const container = document.getElementById('timeline-container');
  if (!container) return;

  console.log('Timeline - All tenants:', tenants);

  if (tenants.length === 0) {
    container.innerHTML = '<p style="padding: 16px; text-align: center; color: #999;">אין דיירים</p>';
    return;
  }

  // Check if any tenants have startDate
  const tenantsWithDates = tenants.filter(t => t.startDate);
  if (tenantsWithDates.length === 0) {
    container.innerHTML = `
      <p style="padding: 16px; text-align: center; color: #999;">
        יש ${tenants.length} דיירים אבל אף אחד לא בעל תאריך התחלה.<br>
        עדכן את הדיירים עם תאריכי התחלה כדי לראות את ציר הזמן.
      </p>
    `;
    return;
  }

  try {
    // Group tenants by apartment
    const byApartment = {};
    tenantsWithDates.forEach(t => {
      const apt = t.apartmentNumber || 'ללא מספר';
      if (!byApartment[apt]) byApartment[apt] = [];
      byApartment[apt].push(t);
    });

    // Sort apartments numerically
    const apartmentsSorted = Object.keys(byApartment).sort((a, b) => {
      const aNum = Number(a);
      const bNum = Number(b);
      if (Number.isNaN(aNum) && Number.isNaN(bNum)) return a.localeCompare(b);
      if (Number.isNaN(aNum)) return 1;
      if (Number.isNaN(bNum)) return -1;
      return aNum - bNum;
    });

    console.log('Timeline - Apartments:', apartmentsSorted, byApartment);

    // Calculate date range
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    
    let minDate = null;
    let maxDate = new Date(today.getTime()); // Today

    tenantsWithDates.forEach(t => {
      if (t.startDate) {
        const d = parseDate(t.startDate);
        if (d && (!minDate || d < minDate)) minDate = d;
      }
    });

    // Default minimum date: October 2022
    const defaultMinDate = new Date(2022, 9, 1); // October 2022, day 1
    
    // If no tenants or earliest tenant is after default, use default
    if (!minDate || minDate > defaultMinDate) {
      minDate = defaultMinDate;
    } else {
      // Go to first of that month
      minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    }
    
    // Ensure minDate is at midnight (00:00:00)
    minDate = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate(), 0, 0, 0, 0);
    
    // Show at least 24 months
    if ((maxDate - minDate) / (1000 * 60 * 60 * 24 * 30.44) < 24) {
      minDate = new Date(maxDate.getFullYear() - 2, maxDate.getMonth(), 1);
    }

    const totalDays = Math.floor((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    
    console.log('Timeline - Date range:', minDate, 'to', maxDate, 'total days:', totalDays);

    // Build year/month axis
    const yearAxis = buildYearAxis(minDate, maxDate, totalDays);
    const monthTicks = buildMonthTicks(minDate, maxDate, totalDays);
    
    // Build apartment rows
    const rows = apartmentsSorted.map(apt => {
      const tenantsList = byApartment[apt];
      console.log('Processing apartment', apt, 'tenants:', tenantsList);
      const bars = buildTimelineBars(tenantsList, minDate, maxDate, totalDays);
      
      return `
        <div class="timeline-row">
          <div class="timeline-apt-label">דירה ${apt}</div>
          <div class="timeline-bars">
            ${bars}
          </div>
        </div>
      `;
    }).join('');

    // Build legend
    const legend = `
      <div class="timeline-legend">
        <div class="legend-item">
          <div class="legend-box legend-active"></div>
          <span>דייר פעיל כרגע</span>
        </div>
        <div class="legend-item">
          <div class="legend-box legend-inactive"></div>
          <span>דייר קודם</span>
        </div>
      </div>
    `;

    container.innerHTML = `
      <div class="timeline-axis">
        <div class="timeline-axis-spacer"></div>
        <div class="timeline-axis-content">
          ${yearAxis}
          ${monthTicks}
        </div>
      </div>
      <div class="timeline-chart">
        ${rows}
      </div>
      ${legend}
    `;
    
    // Add click handlers for timeline bars
    document.querySelectorAll('.tenant-timeline-bar').forEach(bar => {
      bar.style.cursor = 'pointer';
      bar.addEventListener('click', async () => {
        const tenantId = Number(bar.dataset.tenantId);
        await openTenantDateEditor(tenantId);
      });
    });
  } catch (err) {
    console.error('Timeline render error:', err);
    container.innerHTML = `<p style="padding: 16px; color: red;">שגיאה בעריכת קו הזמן: ${err.message}</p>`;
  }
}

function buildYearAxis(minDate, maxDate, totalDays) {
  let html = '<div class="timeline-years">';
  
  let currentDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  let startPos = 0;
  
  while (currentDate <= maxDate) {
    const year = currentDate.getFullYear();
    const nextYear = new Date(year + 1, 0, 1);
    const yearStartDate = new Date(year, 0, 1);
    const yearEndDate = new Date(year, 11, 31);
    
    // חתוך לטווח הנתונים
    const displayStart = yearStartDate < minDate ? minDate : yearStartDate;
    const displayEnd = yearEndDate > maxDate ? maxDate : yearEndDate;
    
    const daysFromMin = Math.floor((displayStart - minDate) / (1000 * 60 * 60 * 24));
    const yearDays = Math.floor((displayEnd - displayStart) / (1000 * 60 * 60 * 24)) + 1;
    
    const leftPercent = (daysFromMin / totalDays) * 100;
    const widthPercent = (yearDays / totalDays) * 100;
    
    html += `
      <div class="timeline-year-label" style="left: ${leftPercent}%; width: ${widthPercent}%;">
        ${year}
      </div>
    `;
    
    currentDate = nextYear;
  }
  
  html += '</div>';
  return html;
}

function buildMonthTicks(minDate, maxDate, totalDays) {
  let html = '<div class="timeline-months">';
  
  let currentDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  
  const monthNames = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
  
  while (currentDate <= maxDate) {
    const daysFromMin = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
    const leftPercent = (daysFromMin / totalDays) * 100;
    
    const month = currentDate.getMonth();
    const monthName = monthNames[month];
    
    html += `
      <div class="timeline-month-tick" style="left: ${leftPercent}%;">
        <div class="month-label">${monthName}</div>
        <div class="month-line"></div>
      </div>
    `;
    
    // עברי לחודש הבא
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  }
  
  html += '</div>';
  return html;
}

function buildTimelineBars(tenantsList, minDate, maxDate, totalDays) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  
  console.log('buildTimelineBars - input:', {
    tenantCount: tenantsList.length,
    minDate,
    maxDate,
    totalDays
  });
  
  // Sort tenants by start date
  const sortedTenants = tenantsList.slice().sort((a, b) => {
    const aDate = parseDate(a.startDate);
    const bDate = parseDate(b.startDate);
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate - bDate;
  });

  let bars = '';
  let gaps = '';
  
  sortedTenants.forEach((t, index) => {
    const startDate = parseDate(t.startDate);
    const endDate = parseDate(t.moveOutDate || t.endDate);
    
    if (!startDate) {
      console.warn('No start date for tenant:', t);
      return;
    }
    
    // Check for gap from previous tenant
    if (index > 0) {
      const prevTenant = sortedTenants[index - 1];
      const prevEndDate = parseDate(prevTenant.moveOutDate || prevTenant.endDate);
      
      if (prevEndDate && prevEndDate < startDate) {
        // There's a gap!
        const gapStartDays = Math.floor((prevEndDate - minDate) / (1000 * 60 * 60 * 24));
        const gapEndDays = Math.floor((startDate - minDate) / (1000 * 60 * 60 * 24));
        const gapDays = gapEndDays - gapStartDays;
        
        const gapLeft = (gapStartDays / totalDays) * 100;
        const gapWidth = (gapDays / totalDays) * 100;
        
        if (gapDays > 0) {
          gaps += `
            <div 
              class="timeline-gap" 
              style="left: ${gapLeft}%; width: ${gapWidth}%;"
              title="${gapDays} ימים ריקים"
            >
              <span class="gap-label">${gapDays} ימים</span>
            </div>
          `;
        }
      }
    }
    
    // Calculate position and width
    const startDays = Math.max(0, Math.floor((startDate - minDate) / (1000 * 60 * 60 * 24)));
    let endDays;
    
    if (!endDate) {
      // Still active
      endDays = totalDays;
    } else {
      endDays = Math.floor((endDate - minDate) / (1000 * 60 * 60 * 24));
    }
    
    const start = Math.max(0, startDays);
    const duration = Math.max(1, Math.min(totalDays - start, endDays - start + 1));
    const width = (duration / totalDays) * 100;
    const left = (start / totalDays) * 100;

    const name = `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'בלא שם';
    
    // Check if tenant is currently active
    // Active = no end date OR end date is in the future
    let isActive = false;
    if (!endDate) {
      isActive = true; // No end date = still active
    } else {
      // Has end date - check if it's in the future
      isActive = endDate > today;
    }
    
    const barClass = isActive ? 'timeline-bar-active' : 'timeline-bar-inactive';
    
    // Show dates as tooltip
    const startStr = t.startDate;
    const endStr = t.moveOutDate || t.endDate || 'עד היום';
    const tooltip = `${name} (${startStr} - ${endStr})`;

    console.log('Bar:', { name, left: left.toFixed(2), width: width.toFixed(2), isActive, startStr, endStr });

    bars += `
      <div 
        class="timeline-bar ${barClass} tenant-timeline-bar" 
        data-tenant-id="${t.id}"
        style="left: ${left}%; width: ${width}%;"
        title="${tooltip}"
      >
        ${name}
      </div>
    `;
  });

  if (!bars && !gaps) {
    console.log('No bars generated, showing empty message');
    bars = '<div style="position: absolute; left: 0; top: 50%; width: 100%; text-align: center; transform: translateY(-50%); color: #ccc; font-size: 12px;">אין דיירים בתקופה זו</div>';
  }

  console.log('Generated bars HTML:', bars);
  return gaps + bars;
}

// Dashboard button handlers
const showDashboardBtn = document.getElementById('show-dashboard');
showDashboardBtn?.addEventListener('click', async () => {
  await renderDashboard();
  show(document.getElementById('dashboard-view'));
});

document.getElementById('close-dashboard')?.addEventListener('click', () => {
  show(tenantForm);
});

document.getElementById('export-timeline-csv')?.addEventListener('click', async () => {
  await exportTimelineCSV();
});

// Tenant date editor modal handlers
let currentEditingTenantId = null;

async function openTenantDateEditor(tenantId) {
  const tenant = isRemoteApp()
    ? await getTenantByIdRemote(tenantId)
    : await getTenantById(tenantId);
  if (!tenant) {
    alert('לא נמצא דייר');
    return;
  }
  
  currentEditingTenantId = tenantId;
  
  // Set modal title and form values
  document.getElementById('edit-dates-tenant-name').textContent = `עריכת תאריכים - ${tenant.firstName} ${tenant.lastName}`;
  document.getElementById('edit-dates-start').value = formatDateEu(tenant.startDate || '');
  document.getElementById('edit-dates-end').value = formatDateEu(tenant.endDate || '');
  document.getElementById('edit-dates-moveout').value = formatDateEu(tenant.moveOutDate || '');
  
  // Show modal
  document.getElementById('edit-dates-modal').classList.remove('hidden');
  document.getElementById('edit-dates-modal').style.display = 'flex';
}

document.getElementById('edit-dates-cancel')?.addEventListener('click', () => {
  document.getElementById('edit-dates-modal').classList.add('hidden');
  document.getElementById('edit-dates-modal').style.display = 'none';
  currentEditingTenantId = null;
});

document.getElementById('edit-dates-save')?.addEventListener('click', async () => {
  if (!currentEditingTenantId) return;
  
  const startDate = document.getElementById('edit-dates-start').value;
  const endDate = document.getElementById('edit-dates-end').value;
  const moveOutDate = document.getElementById('edit-dates-moveout').value;
  
  if (!startDate) {
    alert('תאריך התחלה הוא חובה');
    return;
  }

  const parsedStart = parseDateToIso(startDate);
  const parsedEnd = endDate ? parseDateToIso(endDate) : '';
  const parsedMoveout = moveOutDate ? parseDateToIso(moveOutDate) : '';
  if (!parsedStart) { alert('תאריך התחלה לא תקין'); return; }
  if (endDate && !parsedEnd) { alert('תאריך סיום לא תקין'); return; }
  if (moveOutDate && !parsedMoveout) { alert('תאריך יציאה לא תקין'); return; }
  
  try {
    const payload = {
      startDate: parsedStart,
      endDate: parsedEnd || null,
      moveOutDate: parsedMoveout || null
    };
    if (isRemoteApp()) {
      await updateTenantRemote(currentEditingTenantId, payload);
    } else {
      await updateTenant(currentEditingTenantId, payload);
    }
    
    // Close modal and refresh timeline
    document.getElementById('edit-dates-modal').classList.add('hidden');
    document.getElementById('edit-dates-modal').style.display = 'none';
    currentEditingTenantId = null;
    
    // Re-render dashboard
    await renderDashboard();
    
    alert('תאריכים עודכנו בהצלחה');
  } catch (err) {
    console.error('Error updating tenant dates:', err);
    alert('שגיאה בעדכון תאריכים: ' + err.message);
  }
});

// Init
window.addEventListener('DOMContentLoaded', async () => { 
  // Load app title if saved
  const savedTitle = await getSetting('appTitle');
  if (savedTitle) {
    document.querySelector('header h1').textContent = savedTitle;
    document.title = savedTitle;
  }
  
  // Load server URL if saved
  const savedServerUrl = await getSetting('serverUrl');
  if (savedServerUrl) {
    window.CURRENT_SERVER_URL = savedServerUrl;
  }
  
  // If accessing via remote (Cloudflare), sync remote tenants to local IndexedDB
  if (isRemoteApp()) {
    console.log('Remote app detected - syncing tenants from server to local IndexedDB');
    try {
      const remoteTenantsData = await apiRequest('/api/tenants?includeArchived=true');
      const remoteTenants = (remoteTenantsData || []).map(normalizeTenantRow);
      console.log(`Retrieved ${remoteTenants.length} tenants from server`);
      
      // Replace local IndexedDB tenants with remote
      const db = await openDB();
      const tx = db.transaction('tenants', 'readwrite');
      const store = tx.objectStore('tenants');
      
      // Clear and repopulate
      store.clear();
      remoteTenants.forEach(tenant => store.add(tenant));
      
      await new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      
      console.log(`Synced ${remoteTenants.length} tenants to local IndexedDB`);
    } catch(err) {
      console.error('Failed to sync tenants from server:', err);
    }
  }
  
  await renderTenants(); 
});
