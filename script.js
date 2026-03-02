// Tenant Management App - Vanilla JS + IndexedDB
const APP_VERSION = '2025-02-18-expenses-paid';
console.log('App version:', APP_VERSION);
const DB_NAME = 'tenant_mgmt_v1';
const DB_VERSION = 5;
const STORES = ['tenants', 'readings', 'bills', 'payments', 'expenses', 'solar', 'settings'];

function isRemoteApp() {
  // Check if accessing via file:// protocol - always treat as local
  if (window.location.protocol === 'file:') {
    return false;
  }
  // Any non-file origin uses server auth (localhost or hosted)
  return true;
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

let currentUser = null;

function roleLabel(role, canWrite) {
  if (role === 'admin') return 'מנהל';
  if (role === 'tenant') return 'דייר';
  if (role === 'family') return canWrite ? 'משפחה (מלא)' : 'משפחה (צפייה)';
  return role || '';
}

function getAuthToken() {
  return localStorage.getItem('authToken') || '';
}

function setAuthToken(token) {
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
}

function canWriteCurrentUser() {
  return currentUser && (currentUser.role === 'admin' || (currentUser.role === 'family' && currentUser.canWrite));
}

function canSubmitReadingsCurrentUser() {
  return currentUser && (currentUser.role === 'admin' || (currentUser.role === 'family' && currentUser.canWrite) || (currentUser.role === 'tenant' && currentUser.canSubmitReadings));
}

async function apiRequest(path, options = {}) {
  const API_BASE = getApiBase();
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options
  });
  if (res.status === 401 && !options._retry && !options._skipAuthRetry && !String(path).startsWith('/api/auth/')) {
    await ensureServerAuth();
    return await apiRequest(path, { ...options, _retry: true });
  }
  if (!res.ok) {
    const text = await res.text();
    const message = text ? `HTTP ${res.status} ${text}` : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

function normalizeTenantRow(row) {
  if (!row) return row;
  const normalizedRow = {
    ...row,
    archived: !!row.archived,
    active: row.active === undefined ? true : !!row.active
  };
  normalizedRow.waterMeter = row.waterMeter || '';
  normalizedRow.electricityMeter = row.electricityMeter || '';
  return normalizedRow;
}

function showAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('hidden');
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
}

const authPasswordToggle = document.getElementById('auth-password-toggle');
authPasswordToggle?.addEventListener('change', e => {
  const input = document.getElementById('auth-password');
  if (!input) return;
  input.type = e.target.checked ? 'text' : 'password';
});

async function fetchCurrentUser() {
  try {
    const data = await apiRequest('/api/auth/me', { _skipAuthRetry: true });
    currentUser = data.user || null;
    return currentUser;
  } catch (err) {
    currentUser = null;
    return null;
  }
}

function applyRoleUI() {
  if (!currentUser) return;
  const isTenant = currentUser.role === 'tenant';

  if (isTenant) {
    const hideIds = [
      'show-dashboard',
      'show-add',
      'show-archive',
      'show-settings',
      'show-expenses',
      'show-solar',
      'show-balance',
      'show-mom'
    ];
    hideIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  const canWrite = canWriteCurrentUser();
  if (!canWrite) {
    const disableIds = [
      'save-settings',
      'tenants-import-csv',
      'tenants-clear-all',
      'payments-import-csv',
      'payments-clear-all',
      'expenses-import-csv',
      'expenses-clear-all',
      'solar-import-csv',
      'solar-clear-all',
      'readings-import-csv',
      'readings-clear-all',
      'bulk-electricity-save',
      'bulk-water-save',
      'generate-bills',
      'save-expense',
      'save-solar',
      'save-reminders-settings',
      'enable-browser-notifications',
      'add-manual-reminder',
      'mom-payments-import-csv',
      'mom-payments-clear-all'
    ];
    disableIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    const tenantFormSubmit = document.querySelector('#tenant-form button[type="submit"]');
    if (tenantFormSubmit) tenantFormSubmit.disabled = true;

    const paymentFormSubmit = document.querySelector('#payment-form button[type="submit"]');
    if (paymentFormSubmit) paymentFormSubmit.disabled = true;
  }

  const tenantSubmitPanel = document.getElementById('tenant-reading-submit');
  const bulkPanel = document.querySelector('.bulk-readings');
  if (isTenant) {
    if (tenantSubmitPanel) tenantSubmitPanel.style.display = canSubmitReadingsCurrentUser() ? 'block' : 'none';
    if (bulkPanel) bulkPanel.style.display = 'none';
  }
}

function updateAuthUI() {
  const statusEl = document.getElementById('auth-status');
  const actionBtn = document.getElementById('auth-action-btn');
  const isLocalFile = window.location.protocol === 'file:';

  if (!statusEl || !actionBtn) return;

  if (isLocalFile) {
    statusEl.textContent = 'מצב מקומי';
    actionBtn.classList.add('hidden');
    return;
  }

  if (currentUser) {
    const label = roleLabel(currentUser.role, currentUser.canWrite);
    statusEl.textContent = `${currentUser.email} · ${label}`;
    actionBtn.textContent = 'התנתק';
    actionBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = 'לא מחובר';
    actionBtn.textContent = 'התחבר';
    actionBtn.classList.remove('hidden');
  }
}

async function ensureServerAuth() {
  const token = getAuthToken();
  if (token) {
    const user = await fetchCurrentUser();
    if (user) {
      updateAuthUI();
      applyRoleUI();
      return user;
    }
  }

  showAuthModal();
  return new Promise(resolve => {
    const loginBtn = document.getElementById('auth-login');
    if (!loginBtn) return resolve(null);
    loginBtn.onclick = async () => {
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const errorEl = document.getElementById('auth-error');
      if (errorEl) errorEl.textContent = '';
      try {
        const data = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        setAuthToken(data.token);
        currentUser = data.user || null;
        hideAuthModal();
        updateAuthUI();
        applyRoleUI();
        resolve(currentUser);
      } catch (err) {
        if (errorEl) errorEl.textContent = 'שגיאה בהתחברות. בדוק אימייל וסיסמה.';
      }
    };
  });
}

async function ensureRemoteAuth() {
  if (!isRemoteApp()) return null;
  return await ensureServerAuth();
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

// Find tenant by partial name match (fuzzy matching)
function findTenantByNameMatch(tenants, name) {
  if (!name || !tenants.length) return null;
  
  const normalizedSearch = name.toLowerCase().trim();
  let bestMatch = null;
  let bestScore = 0;
  
  tenants.forEach(t => {
    const fullName = `${t.firstName || ''} ${t.lastName || ''}`.toLowerCase().trim();
    if (!fullName) return;
    
    // Exact match
    if (fullName === normalizedSearch) {
      bestScore = 1000;
      bestMatch = t;
      return;
    }
    
    // Check if search is contained in fullName or vice versa
    if (fullName.includes(normalizedSearch) || normalizedSearch.includes(fullName)) {
      const score = 500;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = t;
      }
    }
    
    // Check if first or last name matches
    const firstName = (t.firstName || '').toLowerCase();
    const lastName = (t.lastName || '').toLowerCase();
    if (firstName && normalizedSearch.includes(firstName)) {
      const score = 300;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = t;
      }
    }
    if (lastName && normalizedSearch.includes(lastName)) {
      const score = 300;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = t;
      }
    }
  });
  
  // Only return match if score is decent
  return bestScore >= 300 ? bestMatch : null;
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
  if (isRemoteApp()) {
    return await addReadingRemote(reading);
  }
  const tx = await getTx('readings', 'readwrite');
  if (reading.paid === undefined) reading.paid = false;
  reading.paid = !!reading.paid;
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
    value: reading.value ?? null,
    paid: !!reading.paid,
    status: reading.status || 'approved'
  };
  return await apiRequest('/api/readings', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function getReadingsByTenant(tenantId) {
  if (isRemoteApp()) {
    const rows = await getAllReadingsRemote();
    return rows.filter(r => Number(r.tenantId) === Number(tenantId));
  }
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
  if (isRemoteApp()) {
    return await getAllReadingsRemote();
  }
  const tx = await getTx('readings', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('readings').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function getAllReadingsRemote() {
  const rows = await apiRequest('/api/readings');
  return (rows || []).map(row => ({ ...row, paid: !!row.paid }));
}

async function getPendingReadingsRemote() {
  const rows = await apiRequest('/api/readings/pending');
  return rows || [];
}

async function getAllReadingsRemote() {
  const rows = await apiRequest('/api/readings');
  return (rows || []).map(row => ({ ...row, paid: !!row.paid }));
}

async function clearAllReadings() {
  if (isRemoteApp()) {
    await apiRequest('/api/readings', { method: 'DELETE' });
    return;
  }
  const tx = await getTx('readings', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('readings').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function updateReading(id, patch) {
  if (isRemoteApp()) {
    return await updateReadingRemote(id, patch);
  }
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
  const existing = await getReadingByIdRemote(id);
  if (!existing) throw new Error('Not found');
  const payload = { ...existing, ...patch };
  return await apiRequest(`/api/readings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

async function deleteReadingRemote(id) {
  await apiRequest(`/api/readings/${id}`, { method: 'DELETE' });
}

async function deleteReading(id) {
  if (isRemoteApp()) {
    return await deleteReadingRemote(id);
  }
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
  if (isRemoteApp()) {
    return await addPaymentRemote(p);
  }
  const tx = await getTx('payments', 'readwrite');
  p.createdAt = new Date().toISOString();
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').add(p);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function updatePayment(id, patch) {
  if (isRemoteApp()) {
    return await updatePaymentRemote(id, patch);
  }
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
  if (isRemoteApp()) {
    return await deletePaymentRemote(id);
  }
  const tx = await getTx('payments', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getAllPayments() {
  if (isRemoteApp()) {
    return await getAllPaymentsRemote();
  }
  const tx = await getTx('payments', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function getPaymentsByTenant(tenantId) {
  if (isRemoteApp()) {
    const rows = await getAllPaymentsRemote();
    return rows.filter(p => Number(p.tenantId) === Number(tenantId));
  }
  const tx = await getTx('payments', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').index('tenantId').getAll(tenantId);
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function clearAllPayments() {
  if (isRemoteApp()) {
    await apiRequest('/api/payments', { method: 'DELETE' });
    return;
  }
  const tx = await getTx('payments', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('payments').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function addPaymentRemote(p) {
  const payload = {
    tenantId: p.tenantId ?? null,
    amount: p.amount ?? null,
    method: p.method || '',
    account: p.account || '',
    date: p.date || '',
    notes: p.notes || ''
  };
  return await apiRequest('/api/payments', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function updatePaymentRemote(id, patch) {
  return await apiRequest(`/api/payments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch)
  });
}

async function deletePaymentRemote(id) {
  await apiRequest(`/api/payments/${id}`, { method: 'DELETE' });
}

async function getAllPaymentsRemote() {
  const rows = await apiRequest('/api/payments');
  return rows || [];
}

const paymentsSort = { key: null, dir: 'asc' };
const readingsSort = { key: null, dir: 'asc' };
const REMINDER_DEFAULTS = {
  contractDays: 30,
  checkDays: 7
};

function getPaymentsFilters() {
  const text = (document.getElementById('payments-filter-text')?.value || '').trim().toLowerCase();
  const tenantIdRaw = document.getElementById('payments-filter-tenant')?.value || '';
  const tenantId = tenantIdRaw ? Number(tenantIdRaw) : null;
  const account = document.getElementById('payments-filter-account')?.value || '';
  const method = document.getElementById('payments-filter-method')?.value || '';
  const from = document.getElementById('payments-filter-from')?.value || '';
  const to = document.getElementById('payments-filter-to')?.value || '';
  return { text, tenantId, account, method, from, to };
}

function getReadingsFilters() {
  const text = (document.getElementById('readings-filter-text')?.value || '').trim().toLowerCase();
  const tenantIdRaw = document.getElementById('readings-filter-tenant')?.value || '';
  const tenantId = tenantIdRaw ? Number(tenantIdRaw) : null;
  const meterType = document.getElementById('readings-filter-type')?.value || '';
  const paid = document.getElementById('readings-filter-paid')?.value || '';
  const from = document.getElementById('readings-filter-from')?.value || '';
  const to = document.getElementById('readings-filter-to')?.value || '';
  return { text, tenantId, meterType, paid, from, to };
}

function bindPaymentsFilters() {
  const triggerIds = [
    'payments-filter-text',
    'payments-filter-tenant',
    'payments-filter-account',
    'payments-filter-method',
    'payments-filter-from',
    'payments-filter-to'
  ];

  triggerIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound === '1') return;
    const handler = () => { renderPayments().catch(console.error); };
    el.addEventListener('change', handler);
    if (id === 'payments-filter-text') el.addEventListener('input', handler);
    el.dataset.bound = '1';
  });

  const clearBtn = document.getElementById('payments-filter-clear');
  if (clearBtn && clearBtn.dataset.bound !== '1') {
    clearBtn.addEventListener('click', () => {
      const text = document.getElementById('payments-filter-text');
      const tenant = document.getElementById('payments-filter-tenant');
      const account = document.getElementById('payments-filter-account');
      const method = document.getElementById('payments-filter-method');
      const from = document.getElementById('payments-filter-from');
      const to = document.getElementById('payments-filter-to');
      if (text) text.value = '';
      if (tenant) tenant.value = '';
      if (account) account.value = '';
      if (method) method.value = '';
      if (from) from.value = '';
      if (to) to.value = '';
      renderPayments().catch(console.error);
    });
    clearBtn.dataset.bound = '1';
  }
}

function bindReadingsFilters() {
  const triggerIds = [
    'readings-filter-text',
    'readings-filter-tenant',
    'readings-filter-type',
    'readings-filter-paid',
    'readings-filter-from',
    'readings-filter-to'
  ];

  triggerIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound === '1') return;
    const handler = () => { renderReadings().catch(console.error); };
    el.addEventListener('change', handler);
    if (id === 'readings-filter-text') el.addEventListener('input', handler);
    el.dataset.bound = '1';
  });

  const clearBtn = document.getElementById('readings-filter-clear');
  if (clearBtn && clearBtn.dataset.bound !== '1') {
    clearBtn.addEventListener('click', () => {
      const text = document.getElementById('readings-filter-text');
      const tenant = document.getElementById('readings-filter-tenant');
      const type = document.getElementById('readings-filter-type');
      const paid = document.getElementById('readings-filter-paid');
      const from = document.getElementById('readings-filter-from');
      const to = document.getElementById('readings-filter-to');
      if (text) text.value = '';
      if (tenant) tenant.value = '';
      if (type) type.value = '';
      if (paid) paid.value = '';
      if (from) from.value = '';
      if (to) to.value = '';
      renderReadings().catch(console.error);
    });
    clearBtn.dataset.bound = '1';
  }
}

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

function compareReadings(a, b, tenantMap, key) {
  const tA = tenantMap.get(a.tenantId) || {};
  const tB = tenantMap.get(b.tenantId) || {};
  switch (key) {
    case 'date':
      return new Date(a.date) - new Date(b.date);
    case 'apartment':
      return Number(tA.apartmentNumber || a.apartmentNumber || 0) - Number(tB.apartmentNumber || b.apartmentNumber || 0);
    case 'tenant':
      return (`${tA.firstName || ''} ${tA.lastName || ''}`.trim() || a.tenantName || '').localeCompare(`${tB.firstName || ''} ${tB.lastName || ''}`.trim() || b.tenantName || '');
    case 'type':
      return meterTypeLabel(a.meterType).localeCompare(meterTypeLabel(b.meterType));
    case 'value':
      return Number(a.value || 0) - Number(b.value || 0);
    case 'paid':
      return Number(!!a.paid) - Number(!!b.paid);
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

const currencyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatCurrency(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return currencyFormatter.format(num);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currentIsoDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetweenIso(fromIso, toIso) {
  if (!fromIso || !toIso) return Number.NaN;
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Number.NaN;
  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function sanitizeManualReminders(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => ({
      id: String(item?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      text: String(item?.text || '').trim(),
      dueDate: parseDateToIso(item?.dueDate || ''),
      done: !!item?.done,
      createdAt: item?.createdAt || new Date().toISOString()
    }))
    .filter(item => item.text);
}

async function getRemindersConfig() {
  const saved = await getSetting('remindersConfig');
  const contractDaysRaw = Number(saved?.contractDays);
  const checkDaysRaw = Number(saved?.checkDays);
  const contractDays = Number.isFinite(contractDaysRaw) && contractDaysRaw > 0
    ? Math.floor(contractDaysRaw)
    : REMINDER_DEFAULTS.contractDays;
  const checkDays = Number.isFinite(checkDaysRaw) && checkDaysRaw > 0
    ? Math.floor(checkDaysRaw)
    : REMINDER_DEFAULTS.checkDays;
  return { contractDays, checkDays };
}

async function getManualReminders() {
  const saved = await getSetting('manualReminders');
  return sanitizeManualReminders(saved);
}

async function setManualReminders(list) {
  await setSetting('manualReminders', sanitizeManualReminders(list));
}

async function getReleasedAutoReminderIds() {
  const saved = await getSetting('releasedAutoReminders');
  if (!Array.isArray(saved)) return [];
  return saved.map(id => String(id || '').trim()).filter(Boolean);
}

async function setReleasedAutoReminderIds(list) {
  const cleaned = Array.from(new Set((Array.isArray(list) ? list : []).map(id => String(id || '').trim()).filter(Boolean)));
  await setSetting('releasedAutoReminders', cleaned);
}

function buildTenantTargetDate(tenant) {
  const moveOutIso = parseDateToIso(tenant?.moveOutDate || '');
  if (moveOutIso) return { kind: 'moveout', iso: moveOutIso };
  const contractIso = parseDateToIso(tenant?.endDate || '');
  if (contractIso) return { kind: 'contract', iso: contractIso };
  return null;
}

function tenantTargetKindLabel(kind) {
  if (kind === 'moveout') return 'עזיבה';
  return 'חוזה';
}

async function buildUpcomingKeyDates() {
  const [tenants, payments] = await Promise.all([
    getAllTenants(true),
    getAllPayments()
  ]);
  const todayIso = currentIsoDate();
  const tenantMap = new Map(tenants.map(t => [Number(t.id), t]));

  const upcomingDeposits = payments
    .filter(p => String(p?.method || '') === 'check')
    .map(p => {
      const dueIso = parseDateToIso(p.date || '');
      if (!dueIso || dueIso < todayIso) return null;
      const tenant = tenantMap.get(Number(p.tenantId));
      const tenantName = tenant
        ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim()
        : (p.tenantName || 'ללא שיוך');
      const apartment = tenant?.apartmentNumber || p.apartmentNumber || '-';
      return {
        id: `up-check-${p.id}`,
        dueDate: dueIso,
        title: `דירה ${apartment}`,
        details: `${tenantName || '-'} · ₪${formatCurrency(p.amount || 0)}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const upcomingContracts = tenants
    .map(t => {
      const target = buildTenantTargetDate(t);
      if (!target || !target.iso || target.iso < todayIso) return null;
      const name = `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'ללא שם';
      const apartment = t.apartmentNumber || '-';
      return {
        id: `up-target-${t.id}-${target.iso}`,
        dueDate: target.iso,
        title: `דירה ${apartment}`,
        details: `${name} · ${tenantTargetKindLabel(target.kind)}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    upcomingDeposits,
    upcomingContracts
  };
}

async function buildAutomaticReminders() {
  const [tenants, readings, payments, config] = await Promise.all([
    getAllTenants(true),
    getAllReadings(),
    getAllPayments(),
    getRemindersConfig()
  ]);

  const todayIso = currentIsoDate();
  const reminders = [];
  const tenantMap = new Map(tenants.map(t => [Number(t.id), t]));

  const readingsByTenantAndMeter = new Map();
  readings.forEach(r => {
    if (!r?.meterType) return;
    const hasTenantId = r.tenantId !== null && r.tenantId !== undefined && String(r.tenantId).trim() !== '';
    const tenantKey = hasTenantId
      ? `id:${Number(r.tenantId)}`
      : `name:${String(r.tenantName || '').trim().toLowerCase()}|apt:${String(r.apartmentNumber || '').trim()}`;
    const key = `${tenantKey}|${String(r.meterType)}`;
    if (!readingsByTenantAndMeter.has(key)) readingsByTenantAndMeter.set(key, []);
    readingsByTenantAndMeter.get(key).push(r);
  });

  const baselineReadingIds = new Set();
  readingsByTenantAndMeter.forEach(group => {
    const sorted = group.slice().sort((a, b) => {
      const da = dateValueFromAny(a?.date);
      const db = dateValueFromAny(b?.date);
      if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
      const ca = dateValueFromAny(a?.createdAt);
      const cb = dateValueFromAny(b?.createdAt);
      if (Number.isFinite(ca) && Number.isFinite(cb) && ca !== cb) return ca - cb;
      return Number(a?.id || 0) - Number(b?.id || 0);
    });
    const first = sorted[0];
    if (first?.id !== undefined && first?.id !== null) {
      baselineReadingIds.add(String(first.id));
    }
  });

  tenants.forEach(t => {
    const tenantName = `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'ללא שם';
    const apartment = t.apartmentNumber || '-';

    const target = buildTenantTargetDate(t);
    if (!target?.iso) return;
    const days = daysBetweenIso(todayIso, target.iso);
    if (!Number.isFinite(days) || days < 0 || days > config.contractDays) return;
    const isMoveOut = target.kind === 'moveout';
    reminders.push({
      id: `${target.kind}-${t.id}-${target.iso}`,
      type: 'auto',
      priority: days <= 7 ? 'high' : 'medium',
      title: isMoveOut
        ? `עזיבת דייר מתקרבת (דירה ${apartment})`
        : `חוזה עומד להסתיים (דירה ${apartment})`,
      details: `${tenantName} · בעוד ${days} ימים`,
      dueDate: target.iso,
      source: isMoveOut ? 'עזיבה' : 'חוזה'
    });
  });

  readings
    .filter(r => !r?.paid && !baselineReadingIds.has(String(r?.id)))
    .forEach(r => {
      const tenant = tenantMap.get(Number(r.tenantId));
      const tenantName = tenant
        ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim()
        : (r.tenantName || 'ללא שיוך');
      const apartment = tenant?.apartmentNumber || r.apartmentNumber || '-';
      const readingIso = parseDateToIso(r.date || '');
      const age = readingIso ? daysBetweenIso(readingIso, todayIso) : Number.NaN;
      reminders.push({
        id: `reading-unpaid-${r.id}`,
        type: 'auto',
        readingId: Number(r.id),
        priority: Number.isFinite(age) && age > 30 ? 'high' : 'medium',
        title: `קריאה לא שולמה (דירה ${apartment})`,
        details: `${tenantName || '-'} · ${meterTypeLabel(r.meterType)} · ערך ${r.value ?? '-'}${Number.isFinite(age) ? ` · מלפני ${age} ימים` : ''}`,
        dueDate: readingIso,
        source: 'קריאות'
      });
    });

  payments
    .filter(p => String(p?.method || '') === 'check')
    .forEach(p => {
      const checkIso = parseDateToIso(p.date || '');
      const daysUntil = daysBetweenIso(todayIso, checkIso);
      if (!Number.isFinite(daysUntil) || daysUntil < 0 || daysUntil > config.checkDays) return;
      const tenant = tenantMap.get(Number(p.tenantId));
      const tenantName = tenant
        ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim()
        : (p.tenantName || 'ללא שיוך');
      const apartment = tenant?.apartmentNumber || p.apartmentNumber || '-';
      reminders.push({
        id: `check-deposit-${p.id}`,
        type: 'auto',
        priority: daysUntil <= 1 ? 'high' : 'low',
        title: `תזכורת הפקדת צ'ק (דירה ${apartment})`,
        details: `${tenantName || '-'} · ₪${formatCurrency(p.amount || 0)} · בעוד ${daysUntil} ימים`,
        dueDate: checkIso,
        source: "צ'קים"
      });
    });

  return reminders;
}

function renderReminderPriorityBadge(priority) {
  if (priority === 'high') return '<span style="background:#fdecea;color:#b71c1c;padding:2px 8px;border-radius:999px;font-size:12px;">גבוה</span>';
  if (priority === 'medium') return '<span style="background:#fff8e1;color:#8a6d3b;padding:2px 8px;border-radius:999px;font-size:12px;">בינוני</span>';
  return '<span style="background:#e8f5e9;color:#1b5e20;padding:2px 8px;border-radius:999px;font-size:12px;">נמוך</span>';
}

async function maybeNotifyForReminders(reminders) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const todayIso = currentIsoDate();
  const lastNotified = await getSetting('lastRemindersNotifyDate');
  if (lastNotified === todayIso) return;

  const urgentCount = reminders.filter(r => {
    if (r.priority === 'high') return true;
    const dueIso = parseDateToIso(r.dueDate || '');
    return !!dueIso && dueIso <= todayIso;
  }).length;
  if (!urgentCount) return;

  try {
    new Notification('תזכורות דיירים', {
      body: `יש ${urgentCount} תזכורות דחופות לטיפול היום`,
      tag: 'tenant-reminders-daily'
    });
    await setSetting('lastRemindersNotifyDate', todayIso);
  } catch (err) {
    console.warn('Notification failed:', err);
  }
}

async function renderReminders() {
  const container = document.getElementById('reminders-list');
  if (!container) return;

  const canWrite = canWriteCurrentUser();
  const textInput = document.getElementById('manual-reminder-text');
  const dueInput = document.getElementById('manual-reminder-due');
  const saveSettingsBtn = document.getElementById('save-reminders-settings');
  const addManualBtn = document.getElementById('add-manual-reminder');
  const contractDaysInput = document.getElementById('reminders-contract-days');
  const checkDaysInput = document.getElementById('reminders-check-days');

  if (textInput) textInput.disabled = !canWrite;
  if (dueInput) dueInput.disabled = !canWrite;
  if (saveSettingsBtn) saveSettingsBtn.disabled = !canWrite;
  if (addManualBtn) addManualBtn.disabled = !canWrite;
  if (contractDaysInput) contractDaysInput.disabled = !canWrite;
  if (checkDaysInput) checkDaysInput.disabled = !canWrite;

  const [config, autoReminders, manualReminders, releasedAutoIds, upcoming] = await Promise.all([
    getRemindersConfig(),
    buildAutomaticReminders(),
    getManualReminders(),
    getReleasedAutoReminderIds(),
    buildUpcomingKeyDates()
  ]);

  if (contractDaysInput && !contractDaysInput.value) {
    contractDaysInput.value = String(config.contractDays);
  }
  if (checkDaysInput && !checkDaysInput.value) {
    checkDaysInput.value = String(config.checkDays);
  }

  const todayIso = currentIsoDate();
  const releasedSet = new Set(releasedAutoIds.map(id => String(id)));
  const activeAutoRows = autoReminders.filter(item => !releasedSet.has(String(item.id)));
  const releasedAutoRows = autoReminders.filter(item => releasedSet.has(String(item.id)));

  const manualRows = manualReminders.map(item => {
    const dueIso = parseDateToIso(item.dueDate || '');
    const overdue = !item.done && dueIso && dueIso < todayIso;
    const priority = overdue ? 'high' : 'low';
    return {
      id: `manual-${item.id}`,
      type: 'manual',
      priority,
      title: item.text,
      details: item.done ? 'הושלם' : 'תזכורת ידנית',
      dueDate: dueIso,
      source: 'ידני',
      done: !!item.done,
      rawId: item.id
    };
  });

  const all = [...activeAutoRows, ...manualRows].sort((a, b) => {
    const aDue = parseDateToIso(a.dueDate || '') || '9999-12-31';
    const bDue = parseDateToIso(b.dueDate || '') || '9999-12-31';
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    const pOrder = { high: 0, medium: 1, low: 2 };
    return (pOrder[a.priority] ?? 9) - (pOrder[b.priority] ?? 9);
  });

  const rows = all.map(r => {
    const dueText = r.dueDate ? formatDateEu(r.dueDate) : 'ללא תאריך';
    let actions = '—';
    if (r.type === 'manual') {
      actions = `
        <button class="btn-toggle-manual-reminder" data-id="${escapeHtml(r.rawId)}" ${canWrite ? '' : 'disabled'}>${r.done ? '↩️ החזר' : '✅ סמן הושלם'}</button>
        <button class="btn-delete-manual-reminder" data-id="${escapeHtml(r.rawId)}" ${canWrite ? '' : 'disabled'}>🗑️ מחק</button>
      `;
    } else if (r.type === 'auto') {
      const markPaidBtn = (r.source === 'קריאות' && Number.isFinite(Number(r.readingId)))
        ? `<button class="btn-mark-reading-paid" data-reading-id="${Number(r.readingId)}" ${canWrite ? '' : 'disabled'}>💰 סמן כשולם</button>`
        : '';
      actions = `${markPaidBtn}<button class="btn-release-auto-reminder" data-id="${escapeHtml(r.id)}" ${canWrite ? '' : 'disabled'}>🕊️ שחרר</button>`;
    }
    const titleStyle = r.done ? 'text-decoration: line-through; color: #666;' : '';
    return `
      <tr>
        <td>${renderReminderPriorityBadge(r.priority)}</td>
        <td style="${titleStyle}">${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.details || '-')}</td>
        <td>${escapeHtml(r.source || '-')}</td>
        <td>${dueText}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">${actions}</td>
      </tr>
    `;
  }).join('');

  const releasedRowsHtml = releasedAutoRows.map(r => {
    const dueText = r.dueDate ? formatDateEu(r.dueDate) : 'ללא תאריך';
    const markPaidBtn = (r.source === 'קריאות' && Number.isFinite(Number(r.readingId)))
      ? `<button class="btn-mark-reading-paid" data-reading-id="${Number(r.readingId)}" ${canWrite ? '' : 'disabled'}>💰 סמן כשולם</button>`
      : '';
    return `
      <tr>
        <td>${renderReminderPriorityBadge(r.priority)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.details || '-')}</td>
        <td>${escapeHtml(r.source || '-')}</td>
        <td>${dueText}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">${markPaidBtn}<button class="btn-restore-auto-reminder" data-id="${escapeHtml(r.id)}" ${canWrite ? '' : 'disabled'}>↩️ החזר</button></td>
      </tr>
    `;
  }).join('');

  const upcomingDepositRows = (upcoming.upcomingDeposits || []).slice(0, 12).map(item => `
    <tr>
      <td>${formatDateEu(item.dueDate)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.details)}</td>
    </tr>
  `).join('');

  const upcomingContractRows = (upcoming.upcomingContracts || []).slice(0, 12).map(item => `
    <tr>
      <td>${formatDateEu(item.dueDate)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.details)}</td>
    </tr>
  `).join('');

  const activeSectionHtml = all.length
    ? `
      <table class="payments-table">
        <thead>
          <tr>
            <th>עדיפות</th>
            <th>נושא</th>
            <th>פרטים</th>
            <th>מקור</th>
            <th>יעד</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `
    : '<p style="color:#666; margin-bottom: 12px;">אין תזכורות פעילות כרגע 🎉</p>';

  const highCount = all.filter(r => r.priority === 'high').length;
  container.innerHTML = `
    <div style="margin-bottom:8px; color:#333;">סה"כ ${all.length} תזכורות · דחופות: ${highCount}</div>
    ${activeSectionHtml}
    <div style="margin-top: 14px; border-top: 1px solid #eee; padding-top: 12px;">
      <h3 style="margin: 0 0 8px 0;">תזכורות ששוחררו</h3>
      ${releasedAutoRows.length ? `
      <table class="payments-table">
        <thead>
          <tr>
            <th>עדיפות</th>
            <th>נושא</th>
            <th>פרטים</th>
            <th>מקור</th>
            <th>יעד</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>${releasedRowsHtml}</tbody>
      </table>
      ` : '<p style="color:#666;">אין תזכורות ששוחררו</p>'}
    </div>
    <div style="margin-top: 14px; border-top: 1px solid #eee; padding-top: 12px;">
      <h3 style="margin: 0 0 8px 0;">מועדי הפקדה קרובים (צ׳קים)</h3>
      ${(upcoming.upcomingDeposits || []).length ? `
      <table class="payments-table">
        <thead><tr><th>תאריך</th><th>דירה</th><th>פרטים</th></tr></thead>
        <tbody>${upcomingDepositRows}</tbody>
      </table>
      ` : '<p style="color:#666;">אין מועדי הפקדה קרובים</p>'}
    </div>
    <div style="margin-top: 14px; border-top: 1px solid #eee; padding-top: 12px;">
      <h3 style="margin: 0 0 8px 0;">מועדי סיום/עזיבה קרובים</h3>
      ${(upcoming.upcomingContracts || []).length ? `
      <table class="payments-table">
        <thead><tr><th>תאריך</th><th>דירה</th><th>פרטים</th></tr></thead>
        <tbody>${upcomingContractRows}</tbody>
      </table>
      ` : '<p style="color:#666;">אין מועדי סיום/עזיבה קרובים</p>'}
    </div>
  `;

  await maybeNotifyForReminders(all);
}

function formatPeriodDisplay(period) {
  const raw = String(period || '').trim();
  if (!raw) return '';
  const parts = raw.match(/\d+/g) || [];
  if (parts.length === 0) return raw;

  const yearPart = parts.find(p => p.length === 4) || parts[parts.length - 1];
  const year = Number(yearPart);
  if (Number.isNaN(year) || String(yearPart).length !== 4) return raw;

  const monthParts = parts.filter(p => p !== yearPart).map(n => Number(n)).filter(n => !Number.isNaN(n));
  let startMonth = 1;
  let endMonth = 12;
  if (monthParts.length >= 1) startMonth = monthParts[0];
  if (monthParts.length >= 2) endMonth = monthParts[1];
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return raw;
  if (endMonth < startMonth) [startMonth, endMonth] = [endMonth, startMonth];
  const startStr = String(startMonth).padStart(2, '0');
  const endStr = String(endMonth).padStart(2, '0');
  return `${startStr}-${endStr}/${year}`;
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

function dateValueFromAny(value) {
  const iso = parseDateToIso(value);
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
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

function readingStatusLabel(status) {
  if (status === 'pending') return 'ממתין לאישור';
  return 'מאושר';
}

function meterTypeFromCsv(value) {
  const raw = String(value || '').trim();
  if (raw === 'חשמל' || raw.toLowerCase() === 'electricity') return 'electricity';
  if (raw === 'מים' || raw.toLowerCase() === 'water') return 'water';
  return '';
}

function accountValueFromCsv(value) {
  const raw = String(value || '').trim();
  if (raw === 'חשבון אסתר ומיכאל' || raw === 'אסתר ומיכאל') return 'grandma';
  if (raw === 'חשבון ניר וליאור' || raw === 'ניר וליאור') return 'my';
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

function buildTenantNamePartsIndex(tenants) {
  const map = new Map();
  tenants.forEach(t => {
    const first = normalizeName(t.firstName || '');
    const last = normalizeName(t.lastName || '');
    if (!first || !last) return;
    const key = `${first}|${last}`;
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

function findTenantByNameParts(namePartsIndex, firstName, lastName) {
  const first = normalizeName(firstName || '');
  const last = normalizeName(lastName || '');
  if (!first || !last) return null;
  const matches = namePartsIndex.get(`${first}|${last}`) || [];
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

  const tenants = isRemoteApp() ? await getAllTenantsRemote(true) : await getAllTenants(true);
  const tenantIndex = buildTenantNameIndex(tenants);
  const tenantPartsIndex = buildTenantNamePartsIndex(tenants);
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
  const useRemote = isRemoteApp();
  const billStore = useRemote ? null : (await getTx('bills', 'readwrite')).objectStore('bills');

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
      if (useRemote) {
        await addBillRemote(bill);
      } else {
        billStore.add(bill);
      }
      created.push(bill);
    }
  }
  return created;
}

async function getAllBills() {
  if (isRemoteApp()) {
    return await getAllBillsRemote();
  }
  const tx = await getTx('bills', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('bills').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function clearAllBills() {
  if (isRemoteApp()) {
    await apiRequest('/api/bills', { method: 'DELETE' });
    return;
  }
  const tx = await getTx('bills', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('bills').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function addBillRemote(bill) {
  const payload = {
    tenantId: bill.tenantId ?? null,
    month: bill.date || '',
    electricity: bill.meterType === 'electricity' ? bill.amount : null,
    water: bill.meterType === 'water' ? bill.amount : null,
    total: bill.amount ?? null
  };
  return await apiRequest('/api/bills', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function getAllBillsRemote() {
  const rows = await apiRequest('/api/bills');
  return rows || [];
}

// Settings
async function getSetting(key) {
  if (isRemoteApp()) {
    return await getSettingRemote(key);
  }
  const tx = await getTx('settings', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('settings').get(key);
    r.onsuccess = () => res(r.result?.value ?? null);
    r.onerror = () => rej(r.error);
  });
}

async function setSetting(key, value) {
  if (isRemoteApp()) {
    await setSettingRemote(key, value);
    return;
  }
  const tx = await getTx('settings', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('settings').put({ key, value });
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getAllSettingsLocal() {
  const tx = await getTx('settings', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('settings').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

function parseSettingValueRemote(value) {
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

async function getSettingRemote(key) {
  try {
    const row = await apiRequest(`/api/settings/${encodeURIComponent(key)}`);
    return parseSettingValueRemote(row?.value);
  } catch (err) {
    if (String(err.message || '').includes('404')) return null;
    throw err;
  }
}

async function setSettingRemote(key, value) {
  await apiRequest(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value })
  });
}

async function getAllSettingsRemote() {
  const rows = await apiRequest('/api/settings');
  return (rows || []).map(row => ({ ...row, value: parseSettingValueRemote(row?.value) }));
}

async function getAllFromStoreLocal(storeName) {
  const tx = await getTx(storeName, 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore(storeName).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function syncAllLocalDataToServer() {
  const statusEl = document.getElementById('sync-status');
  if (statusEl) statusEl.textContent = 'בודק הרשאות...';

  const user = await ensureServerAuth();
  if (!user) return;
  if (user.role !== 'admin') {
    if (statusEl) statusEl.textContent = 'רק מנהל יכול לבצע סנכרון מלא.';
    return;
  }

  const confirmed = await confirmDialog('הסנכרון ימחק את הנתונים בשרת ויעלה את הנתונים המקומיים. להמשיך?');
  if (!confirmed) {
    if (statusEl) statusEl.textContent = '';
    return;
  }

  if (statusEl) statusEl.textContent = 'מעלה נתונים לשרת...';

  const tenants = await getAllFromStoreLocal('tenants');
  const readings = await getAllFromStoreLocal('readings');
  const payments = await getAllFromStoreLocal('payments');
  const bills = await getAllFromStoreLocal('bills');
  const expenses = await getAllFromStoreLocal('expenses');
  const solar = await getAllFromStoreLocal('solar');
  const settings = await getAllSettingsLocal();

  await apiRequest('/api/readings', { method: 'DELETE' });
  await apiRequest('/api/bills', { method: 'DELETE' });
  await apiRequest('/api/payments', { method: 'DELETE' });
  await apiRequest('/api/tenants', { method: 'DELETE' });
  await apiRequest('/api/expenses', { method: 'DELETE' });
  await apiRequest('/api/solar', { method: 'DELETE' });
  await apiRequest('/api/settings', { method: 'DELETE' });

  for (const tenant of tenants) {
    await addTenantRemote(tenant);
  }

  const remoteTenants = await getAllTenantsRemote(true);
  const remoteNameIndex = buildTenantNameIndex(remoteTenants);
  const remoteByApartment = new Map();
  remoteTenants.forEach(t => {
    const aptKey = String(t.apartmentNumber || '').trim();
    if (!aptKey) return;
    if (!remoteByApartment.has(aptKey)) remoteByApartment.set(aptKey, t);
  });

  const remoteByKey = new Map();
  remoteTenants.forEach(t => {
    const key = `${normalizeName(buildTenantName(t))}|${String(t.apartmentNumber || '').trim()}`;
    if (!key.trim()) return;
    if (remoteByKey.has(key)) {
      remoteByKey.set(key, null);
    } else {
      remoteByKey.set(key, t);
    }
  });

  const localToRemoteId = new Map();
  tenants.forEach(t => {
    const key = `${normalizeName(buildTenantName(t))}|${String(t.apartmentNumber || '').trim()}`;
    let remote = remoteByKey.get(key) || null;
    if (!remote && t.apartmentNumber) {
      remote = remoteByApartment.get(String(t.apartmentNumber).trim()) || null;
    }
    if (!remote) {
      remote = findTenantByName(remoteNameIndex, buildTenantName(t));
    }
    if (remote) localToRemoteId.set(t.id, remote.id);
  });

  let unmatchedReadings = 0;
  let unmatchedPayments = 0;
  let unmatchedBills = 0;

  for (const r of readings) {
    const mappedTenantId = localToRemoteId.get(r.tenantId) || null;
    if (!mappedTenantId) {
      unmatchedReadings++;
      continue;
    }
    await addReadingRemote({
      tenantId: mappedTenantId,
      meterType: r.meterType || '',
      date: r.date || '',
      value: r.value ?? null,
      status: r.status || 'approved'
    });
  }

  for (const p of payments) {
    const mappedTenantId = localToRemoteId.get(p.tenantId) || null;
    if (!mappedTenantId) {
      unmatchedPayments++;
      continue;
    }
    await addPaymentRemote({
      ...p,
      tenantId: mappedTenantId
    });
  }

  for (const b of bills) {
    const mappedTenantId = localToRemoteId.get(b.tenantId) || null;
    if (!mappedTenantId) {
      unmatchedBills++;
      continue;
    }
    await addBillRemote({
      ...b,
      tenantId: mappedTenantId
    });
  }

  for (const e of expenses) {
    await addExpenseRemote(e);
  }

  for (const s of solar) {
    await addSolarIncomeRemote(s);
  }

  for (const item of settings) {
    await setSettingRemote(item.key, item.value);
  }

  if (statusEl) {
    const parts = [];
    if (unmatchedReadings) parts.push(`${unmatchedReadings} קריאות ללא התאמה`);
    if (unmatchedPayments) parts.push(`${unmatchedPayments} תשלומים ללא התאמה`);
    if (unmatchedBills) parts.push(`${unmatchedBills} חשבונות ללא התאמה`);
    const suffix = parts.length ? ` (${parts.join(', ')})` : '';
    statusEl.textContent = `הסנכרון הושלם ✓${suffix}`;
  }
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
  const iso = parseDateToIso(dateStr);
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === year && (d.getMonth() + 1) === month;
}

function getMonthFirstReading(readings, year, month) {
  const monthReadings = readings.filter(r => isInMonth(r.date, year, month))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return monthReadings[0] || null;
}

function getClosestBefore(readings, dateStr) {
  const targetValue = dateValueFromAny(dateStr);
  if (Number.isNaN(targetValue)) return null;
  const before = readings.filter(r => dateValueFromAny(r.date) < targetValue)
    .sort((a, b) => dateValueFromAny(b.date) - dateValueFromAny(a.date));
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

function resolveReadingDisplayInfo(tenant, waterCurrent, elecCurrent) {
  const nameFromReading = (waterCurrent?.tenantName || elecCurrent?.tenantName || '').trim();
  const aptFromReading = (waterCurrent?.apartmentNumber || elecCurrent?.apartmentNumber || '').trim();
  const fallbackName = `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim();
  const fallbackApt = tenant.apartmentNumber || '';
  return {
    tenantName: nameFromReading || fallbackName,
    apartment: aptFromReading || fallbackApt
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
    const displayInfo = resolveReadingDisplayInfo(t, waterCurrent, elecCurrent);

    return {
      tenantName: displayInfo.tenantName,
      apartment: displayInfo.apartment,
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
          <th>שיתוף</th>
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

  const body = report.rows.map((r, idx) => {
    const w = r.water || {};
    const e = r.electric || {};
    return `
      <tr>
        <td>${r.tenantName || '-'}</td>
        <td>${r.apartment || '-'}</td>
        <td><button class="btn-pdf" data-row-index="${idx}" data-tenant="${r.apartment}">PDF</button></td>
        <td><button class="btn-whatsapp-pdf" data-row-index="${idx}" data-tenant="${r.apartment}" title="שיתוף דוח">📤</button></td>
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

function getSaveAsFileType(filename, mimeType) {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
  const defaultMime = mimeType || (ext === 'csv' ? 'text/csv' : ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  const description = ext ? `${ext.toUpperCase()} file` : 'File';
  return {
    description,
    accept: {
      [defaultMime]: ext ? [`.${ext}`] : ['.*']
    }
  };
}

async function saveBlobAs(blob, filename, mimeType = '') {
  if (typeof window.showSaveFilePicker === 'function' && window.isSecureContext) {
    try {
      const fileType = getSaveAsFileType(filename, mimeType || blob.type);
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [fileType],
        excludeAcceptAllOption: false
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
      console.warn('Save As not available, falling back to download:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

async function downloadCsv(content, filename) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  return await saveBlobAs(blob, filename, 'text/csv');
}

function buildTenantPdfHtml(row, monthValue) {
  const content = buildTenantPdfContentHtml(row, monthValue);
  return `
    <html lang="he" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>דוח דייר</title>
      </head>
      <body>
        ${content}
      </body>
    </html>
  `;
}

function buildTenantPdfContentHtml(row, monthValue) {
  const w = row.water || {};
  const e = row.electric || {};
  const total = (row.total ?? 0).toFixed(2);
  return `
      <style>
        .tenant-pdf-root{font-family:Arial, sans-serif; direction:rtl; padding:24px;}
        .tenant-pdf-root h1{font-size:20px; margin-bottom:8px;}
        .tenant-pdf-root table{width:100%; border-collapse:collapse; margin-top:12px;}
        .tenant-pdf-root th,.tenant-pdf-root td{border:1px solid #ccc; padding:6px; font-size:12px;}
        .tenant-pdf-root th{background:#f3f3f3;}
        .tenant-pdf-root .section{margin-top:16px;}
      </style>
      <div class="tenant-pdf-root">
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
        <div class="section" style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 12px; font-size: 13px;">
          <strong>הערת תשלום:</strong><br>
          ניתן לשלם בביט 052-3277732 ניר<br>
          או לחשבון:<br>
          הבינלאומי, מספר בנק 31<br>
          מספר סניף 052 - נהריה<br>
          מספר חשבון: 374989<br>
          ע"ש ניר וליאור כהן
        </div>
      </div>
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

function buildTenantReportPdfFilename(row, monthValue) {
  const month = String(monthValue || '').replace(/[^0-9-]/g, '');
  const apt = String(row?.apartment || 'NA').replace(/[^0-9A-Za-zא-ת_-]/g, '-');
  return `tenant_report_${month}_apt_${apt}.pdf`;
}

async function generateTenantPdfBlob(row, monthValue, filename = '') {
  const jsPDFClass = window.jspdf?.jsPDF || window.jsPDF?.jsPDF || window.jsPDF;
  if (!jsPDFClass) {
    throw new Error('jsPDF לא זמין בדפדפן');
  }
  if (typeof window.html2canvas !== 'function') {
    throw new Error('html2canvas לא זמין בדפדפן');
  }

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-10000px';
  wrapper.style.top = '0';
  wrapper.style.width = '794px';
  wrapper.style.background = '#fff';
  wrapper.style.opacity = '1';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '-1';
  wrapper.innerHTML = buildTenantPdfContentHtml(row, monthValue);
  document.body.appendChild(wrapper);

  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await window.html2canvas(wrapper, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: wrapper.scrollWidth,
      windowHeight: wrapper.scrollHeight,
      scrollX: 0,
      scrollY: 0
    });

    const imageData = canvas.toDataURL('image/png');
    const pdf = new jsPDFClass('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const renderWidth = pageWidth - margin * 2;
    const renderHeight = (canvas.height * renderWidth) / canvas.width;

    if (renderHeight <= pageHeight - margin * 2) {
      pdf.addImage(imageData, 'PNG', margin, margin, renderWidth, renderHeight);
    } else {
      let remainingHeight = renderHeight;
      let yOffset = 0;
      while (remainingHeight > 0) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imageData, 'PNG', margin, margin - yOffset, renderWidth, renderHeight);
        remainingHeight -= (pageHeight - margin * 2);
        yOffset += (pageHeight - margin * 2);
      }
    }

    return pdf.output('blob');
  } finally {
    wrapper.remove();
  }
}

async function shareTenantReportToWhatsApp(row, monthValue) {
  const filename = buildTenantReportPdfFilename(row, monthValue);
  let pdfBlob;
  try {
    pdfBlob = await generateTenantPdfBlob(row, monthValue, filename);
  } catch (err) {
    console.error(err);
    alert('לא ניתן ליצור קובץ PDF לשיתוף כרגע');
    return;
  }

  const shareText = `דוח חשבונות לחודש ${formatMonthEu(monthValue)} · דירה ${row.apartment || '-'}`;
  let file = null;
  try {
    file = new File([pdfBlob], filename, { type: 'application/pdf' });
  } catch (err) {
    file = null;
  }

  if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: 'דוח חשבונות',
        text: shareText,
        files: [file]
      });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn('Native share failed, falling back to download + WhatsApp link', err);
    }
  }

  await saveBlobAs(pdfBlob, filename, 'application/pdf');
  const waText = `${shareText}\nהקובץ נשמר אצלך, אפשר לצרף אותו עכשיו בוואטסאפ.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank');
}

// UI Elements
const tenantList = document.getElementById('tenant-list');
const tenantForm = document.getElementById('tenant-form');
const archiveView = document.getElementById('archive-view');
const readingsView = document.getElementById('readings-view');
const settingsView = document.getElementById('settings-view');
const paymentsView = document.getElementById('payments-view');
const remindersView = document.getElementById('reminders-view');
const balanceView = document.getElementById('balance-view');
const dashboardView = document.getElementById('dashboard-view');
const momView = document.getElementById('mom-view');
const confirmModal = document.getElementById('confirm-modal');

// UI Helpers
function hideAll() { [tenantForm, archiveView, readingsView, settingsView, paymentsView, remindersView, expensesView, solarView, balanceView, dashboardView, momView].forEach(x => x?.classList.add('hidden')); }
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

function sortTenantsByApartment(tenants) {
  return tenants.slice().sort((a, b) => {
    const aRaw = String(a.apartmentNumber || '').trim();
    const bRaw = String(b.apartmentNumber || '').trim();
    const aNum = Number(aRaw);
    const bNum = Number(bRaw);
    const aIsNum = !Number.isNaN(aNum);
    const bIsNum = !Number.isNaN(bNum);

    if (aIsNum && bIsNum) return aNum - bNum;
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return aRaw.localeCompare(bRaw, 'he');
  });
}

function buildLatestReadingMap(readings, meterType) {
  const map = new Map();
  (readings || [])
    .filter(r => r && r.meterType === meterType && r.tenantId)
    .forEach(r => {
      const tenantId = Number(r.tenantId);
      const existing = map.get(tenantId);
      if (!existing) {
        map.set(tenantId, r);
        return;
      }

      const currentDateValue = dateValueFromAny(r.date);
      const existingDateValue = dateValueFromAny(existing.date);
      if (currentDateValue > existingDateValue) {
        map.set(tenantId, r);
        return;
      }
      if (currentDateValue === existingDateValue && Number(r.id || 0) > Number(existing.id || 0)) {
        map.set(tenantId, r);
      }
    });
  return map;
}

function formatReadingValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  return num.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function buildBulkList(containerId, tenants, meterKey, unitLabel, latestReadingsByTenant = new Map()) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  tenants.forEach(t => {
    const meter = t[meterKey] || '';
    const latest = latestReadingsByTenant.get(Number(t.id));
    const previousReadingText = latest
      ? `${formatReadingValue(latest.value)} (${formatDateEu(latest.date)})`
      : 'אין קריאה קודמת';
    const row = document.createElement('div');
    row.className = 'bulk-row';
    row.innerHTML = `
      <div class="bulk-main">
        <div class="bulk-title">דירה ${t.apartmentNumber || '-'} · ${t.firstName || ''} ${t.lastName || ''}</div>
        <div class="bulk-sub">מונה: ${meter || 'לא מוגדר'}</div>
        <div class="bulk-sub">קריאה קודמת: ${previousReadingText}</div>
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
    const rent = !Number.isNaN(rentNum) && String(t.rentAmount).trim() !== '' ? `<span style="direction: ltr; display: inline-block;">₪${formatCurrency(rentNum)}</span>` : '-';
    const arnonaNum = Number(t.arnonaAmount);
    const arnona = !Number.isNaN(arnonaNum) && String(t.arnonaAmount).trim() !== '' ? `<span style="direction: ltr; display: inline-block;">₪${formatCurrency(arnonaNum)}</span>` : '-';
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
    const rent = !Number.isNaN(rentNum) && String(t.rentAmount).trim() !== '' ? `<span style="direction: ltr; display: inline-block;">₪${formatCurrency(rentNum)}</span>` : '-';
    const arnonaNum = Number(t.arnonaAmount);
    const arnona = !Number.isNaN(arnonaNum) && String(t.arnonaAmount).trim() !== '' ? `<span style="direction: ltr; display: inline-block;">₪${formatCurrency(arnonaNum)}</span>` : '-';
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
  bindReadingsFilters();
  const list = document.getElementById('readings-list');
  if (!list) return;
  list.innerHTML = '';

  try {
    const all = await getAllReadings();
    const tenants = await getAllTenants(true);
    const waterPrice = Number(await getSetting('waterPrice') ?? 0);
    const kvaCon = Number(await getSetting('kvaCon') ?? 0);
    const allowWrite = canWriteCurrentUser();
    const showStatus = isRemoteApp();

    const tenantMap = new Map(tenants.map(t => [t.id, t]));

    const tenantFilterEl = document.getElementById('readings-filter-tenant');
    if (tenantFilterEl) {
      const prevSelected = tenantFilterEl.value;
      tenantFilterEl.innerHTML = `<option value="">כל הדיירים</option>${tenants.map(t => {
        const name = `${t.firstName || ''} ${t.lastName || ''}`.trim();
        const label = `${t.apartmentNumber || '-'}: ${name || '-'}`;
        return `<option value="${t.id}">${label}</option>`;
      }).join('')}`;
      const selectedExists = tenants.some(t => String(t.id) === String(prevSelected));
      tenantFilterEl.value = selectedExists ? prevSelected : '';
    }

    if (all.length === 0) { list.innerHTML = '<p>אין קריאות</p>'; return; }
    
    // Try to auto-link readings without tenantId to matching tenants by name
    if (allowWrite) {
      for (const r of all) {
        if (!r.tenantId && r.tenantName) {
          const matchedTenant = findTenantByNameMatch(tenants, r.tenantName);
          if (matchedTenant) {
            await updateReading(r.id, {
              tenantId: matchedTenant.id,
              tenantName: `${matchedTenant.firstName || ''} ${matchedTenant.lastName || ''}`.trim(),
              apartmentNumber: matchedTenant.apartmentNumber || ''
            });
            tenantMap.set(matchedTenant.id, matchedTenant);
            r.tenantId = matchedTenant.id;
            r.tenantName = `${matchedTenant.firstName || ''} ${matchedTenant.lastName || ''}`.trim();
            r.apartmentNumber = matchedTenant.apartmentNumber || '';
          }
        }
      }
    }
    
    const filters = getReadingsFilters();
    const filtered = all.filter(r => {
      const t = tenantMap.get(r.tenantId);
      const name = t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (r.tenantName || '');
      const apartment = t?.apartmentNumber || r.apartmentNumber || '';
      const notes = r.notes || '';

      if (filters.tenantId && Number(r.tenantId) !== Number(filters.tenantId)) return false;
      if (filters.meterType && String(r.meterType || '') !== filters.meterType) return false;
      if (filters.paid === 'paid' && !r.paid) return false;
      if (filters.paid === 'unpaid' && !!r.paid) return false;

      const iso = parseDateToIso(r.date);
      if (filters.from && (!iso || iso < filters.from)) return false;
      if (filters.to && (!iso || iso > filters.to)) return false;

      if (filters.text) {
        const haystack = `${name} ${apartment} ${notes} ${meterTypeLabel(r.meterType)} ${r.value ?? ''}`.toLowerCase();
        if (!haystack.includes(filters.text)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<p>אין קריאות לפי הסינון שנבחר</p>';
      return;
    }

    const sorted = filtered.slice();
    if (readingsSort.key) {
      const dir = readingsSort.dir === 'asc' ? 1 : -1;
      sorted.sort((a, b) => compareReadings(a, b, tenantMap, readingsSort.key) * dir);
    } else {
      sorted.sort((a, b) => dateValueFromAny(b.date) - dateValueFromAny(a.date));
    }
    const readingsByKey = new Map();
    sorted.forEach(r => {
      const key = `${r.tenantId || ''}|${r.meterType || ''}`;
      if (!readingsByKey.has(key)) readingsByKey.set(key, []);
      readingsByKey.get(key).push(r);
    });
    readingsByKey.forEach(arr => arr.sort((a, b) => dateValueFromAny(a.date) - dateValueFromAny(b.date)));

    const prevById = new Map();
    const readingById = new Map();
    readingsByKey.forEach(arr => {
      for (let i = 0; i < arr.length; i++) {
        const current = arr[i];
        const prev = i > 0 ? arr[i - 1] : null;
        prevById.set(current.id, prev);
        readingById.set(current.id, current);
      }
    });

    window.__readingsDetailCache = {
      prevById,
      readingById,
      tenantMap,
      waterPrice,
      kvaCon
    };

    const rows = sorted.map(r => {
      const t = tenantMap.get(r.tenantId);
      const name = t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (r.tenantName || '');
      const apartment = t?.apartmentNumber || r.apartmentNumber || '';
      const missing = !t;
      const linkCell = allowWrite && missing ? `
        <select class="link-reading-select" data-reading-id="${r.id}">
          ${buildTenantSelectOptions(tenants)}
        </select>
      ` : '—';
      const statusCell = showStatus ? `<td>${readingStatusLabel(r.status)}</td>` : '';
        const paidCell = `<td><input type="checkbox" class="reading-paid-toggle" data-reading-id="${r.id}" ${r.paid ? 'checked' : ''} ${allowWrite ? '' : 'disabled'} aria-label="שולם"></td>`;
      const actionsCell = allowWrite ? `
          <button class="btn-edit-reading" data-id="${r.id}">✏️</button>
          <button class="btn-delete-reading" data-id="${r.id}">🗑️</button>
      ` : '—';
      return `
        <tr class="${missing ? 'row-missing' : ''} reading-row" data-reading-id="${r.id}">
          <td>${formatDateEu(r.date)}</td>
          <td>${apartment || '-'}</td>
          <td>${name || '-'}</td>
          <td>${meterTypeLabel(r.meterType)}</td>
          <td>${r.value ?? ''}</td>
          <td>${r.notes || '-'}</td>
          ${paidCell}
          <td>${linkCell}</td>
          ${statusCell}
          <td>${actionsCell}</td>
        </tr>
        <tr class="reading-detail-row hidden" data-reading-id="${r.id}">
          <td colspan="${showStatus ? 10 : 9}"></td>
        </tr>
      `;
    }).join('');

    const statusHeader = showStatus ? '<th>סטטוס</th>' : '';
    list.innerHTML = `
      <table class="payments-table">
        <thead>
          <tr>
            <th data-key="date">תאריך</th>
            <th data-key="apartment">דירה</th>
            <th data-key="tenant">דייר</th>
            <th data-key="type">סוג</th>
            <th data-key="value">ערך</th>
            <th>הערות</th>
            <th data-key="paid">שולם</th>
            <th>קישור</th>
            ${statusHeader}
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

  await renderReadingApprovals();
}

async function renderReadingApprovals() {
  const container = document.getElementById('readings-approvals');
  if (!container) return;
  if (!isRemoteApp() || !canWriteCurrentUser()) {
    container.innerHTML = '';
    return;
  }

  try {
    const pending = await getPendingReadingsRemote();
    if (!pending.length) {
      container.innerHTML = '<p style="color: #666;">אין קריאות שממתינות לאישור</p>';
      return;
    }

    const tenants = await getAllTenants(true);
    const tenantMap = new Map(tenants.map(t => [t.id, t]));
    const rows = pending.map(r => {
      const t = tenantMap.get(r.tenantId);
      const name = t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (r.tenantName || '');
      const apartment = t?.apartmentNumber || r.apartmentNumber || '';
      return `
        <tr>
          <td>${formatDateEu(r.date)}</td>
          <td>${apartment || '-'}</td>
          <td>${name || '-'}</td>
          <td>${meterTypeLabel(r.meterType)}</td>
          <td>${r.value ?? ''}</td>
          <td>
            <button class="btn-approve-reading" data-id="${r.id}">אשר</button>
            <button class="btn-reject-reading" data-id="${r.id}">דחה</button>
          </td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <h3 style="margin-bottom: 8px;">קריאות ממתינות לאישור</h3>
      <table class="payments-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>דירה</th>
            <th>דייר</th>
            <th>סוג</th>
            <th>ערך</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="color: #e74c3c;">שגיאה בטעינת אישורים: ${err.message}</p>`;
  }
}

async function renderPayments() {
  bindPaymentsFilters();
  const all = await getAllPayments();
  const list = document.getElementById('payments-list');
  if (all.length === 0) {
    list.innerHTML = '<p>אין תשלומים</p>';
    return;
  }

  const tenants = isRemoteApp()
    ? await getAllTenantsRemote(true)
    : await getAllTenants(true);
  const tenantMap = new Map(tenants.map(t => [t.id, t]));
  const allowWrite = canWriteCurrentUser();

  const tenantFilterEl = document.getElementById('payments-filter-tenant');
  if (tenantFilterEl) {
    const prevSelected = tenantFilterEl.value;
    tenantFilterEl.innerHTML = `<option value="">כל הדיירים</option>${tenants.map(t => {
      const name = `${t.firstName || ''} ${t.lastName || ''}`.trim();
      const label = `${t.apartmentNumber || '-'}: ${name || '-'}`;
      return `<option value="${t.id}">${label}</option>`;
    }).join('')}`;
    const selectedExists = tenants.some(t => String(t.id) === String(prevSelected));
    tenantFilterEl.value = selectedExists ? prevSelected : '';
  }
  
  // Try to auto-link payments without tenantId to matching tenants by name
  for (const p of all) {
    if (!p.tenantId && p.tenantName) {
      const matchedTenant = findTenantByNameMatch(tenants, p.tenantName);
      if (matchedTenant) {
        await updatePayment(p.id, {
          tenantId: matchedTenant.id,
          tenantName: `${matchedTenant.firstName || ''} ${matchedTenant.lastName || ''}`.trim(),
          apartmentNumber: matchedTenant.apartmentNumber || ''
        });
        tenantMap.set(matchedTenant.id, matchedTenant);
        p.tenantId = matchedTenant.id;
        p.tenantName = `${matchedTenant.firstName || ''} ${matchedTenant.lastName || ''}`.trim();
        p.apartmentNumber = matchedTenant.apartmentNumber || '';
      }
    }
  }
  
  const filters = getPaymentsFilters();
  const filtered = all.filter(p => {
    const t = tenantMap.get(p.tenantId);
    const name = t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (p.tenantName || '');
    const apartment = t?.apartmentNumber || p.apartmentNumber || '';
    const notes = p.notes || '';

    if (filters.tenantId && Number(p.tenantId) !== Number(filters.tenantId)) return false;
    if (filters.account && String(p.account || '') !== filters.account) return false;
    if (filters.method && String(p.method || '') !== filters.method) return false;

    const iso = parseDateToIso(p.date);
    if (filters.from && (!iso || iso < filters.from)) return false;
    if (filters.to && (!iso || iso > filters.to)) return false;

    if (filters.text) {
      const haystack = `${name} ${apartment} ${notes}`.toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });

  const sorted = filtered.slice();
  if (paymentsSort.key) {
    const dir = paymentsSort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => comparePayments(a, b, tenantMap, paymentsSort.key) * dir);
  } else {
    sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  if (sorted.length === 0) {
    list.innerHTML = '<p>אין תשלומים לפי הסינון שנבחר</p>';
    return;
  }

  const rows = sorted.map(p => {
    const t = tenantMap.get(p.tenantId);
    const name = t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : (p.tenantName || '');
    const apartment = t?.apartmentNumber || p.apartmentNumber || '';
    const missing = !t;
    const linkCell = allowWrite && missing ? `
      <select class="link-payment-select" data-payment-id="${p.id}">
        ${buildTenantSelectOptions(tenants)}
      </select>
    ` : '—';
    const actionsCell = allowWrite ? `
          <button class="btn-edit-payment" data-id="${p.id}">✏️</button>
          <button class="btn-delete-payment" data-id="${p.id}">🗑️</button>
    ` : '—';
    return `
      <tr class="${missing ? 'row-missing' : ''}">
        <td>${formatDateEu(p.date)}</td>
        <td>${apartment || '-'}</td>
        <td>${name || '-'}</td>
        <td style="direction: ltr; text-align: left;">₪${formatCurrency(p.amount)}</td>
        <td>${accountLabel(p.account)}</td>
        <td>${p.method || ''}</td>
        <td>${p.notes || ''}</td>
        <td>${linkCell}</td>
        <td>${actionsCell}</td>
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
  const payments = await getAllPayments();
  const readings = await getAllReadings();
  const tenants = await getAllTenants(true);
  const expenses = await getAllExpenses();
  const waterPrice = Number(await getSetting('waterPrice') ?? 0);
  const kvaCon = Number(await getSetting('kvaCon') ?? 0);
  const includeSolarCheckbox = document.getElementById('balance-include-solar');
  const includeSolar = includeSolarCheckbox
    ? includeSolarCheckbox.checked
    : (await getSetting('balanceIncludeSolar')) !== false;
  const solarIncome = includeSolar ? await getAllSolarIncome() : [];
  const parentDefaultRaw = await getSetting('parentPaymentDefault');
  const parentPeriodsText = await getSetting('parentPaymentPeriods');
  const parentExempt = await getSetting('parentPaymentExemptMonths');
  const parentReductionsRaw = await getSetting('parentPaymentReductions');
  const parentDefault = Number(parentDefaultRaw ?? 4400) || 0;
  const parentPeriods = parseParentPaymentPeriods(parentPeriodsText || '');
  const parentExemptSet = new Set(Array.isArray(parentExempt) ? parentExempt : []);
  const parentReductions = parentReductionsRaw || {};
  const list = document.getElementById('balance-list');
  if (!list) return;
  list.innerHTML = '';

  function parseExpensePeriod(period) {
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

  const monthly = new Map();
  const monthlyDetails = new Map();
  const ensureMonth = key => {
    if (!monthly.has(key)) monthly.set(key, { income: 0, expense: 0 });
    return monthly.get(key);
  };
  const ensureDetails = key => {
    if (!monthlyDetails.has(key)) monthlyDetails.set(key, { incomes: [], expenses: [] });
    return monthlyDetails.get(key);
  };
  const tenantMap = new Map(tenants.map(t => [t.id, t]));

  payments.forEach(p => {
    const iso = parseDateToIso(p.date);
    if (!iso) return;
    const key = iso.slice(0, 7);
    const rec = ensureMonth(key);
    rec.income += Number(p.amount || 0);
    const tenant = tenantMap.get(p.tenantId);
    const resolvedTenantName = tenant
      ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim()
      : (p.tenantName || '');
    const details = ensureDetails(key);
    details.incomes.push({
      date: p.date,
      tenantName: resolvedTenantName,
      account: p.account || '',
      method: p.method || '',
      amount: Number(p.amount || 0)
    });
  });

  solarIncome.forEach(item => {
    const amount = Number(item.amount || 0);
    if (!amount) return;
    const period = String(item.period || '').trim();
    const periodParts = parseExpensePeriod(period);

    if (periodParts) {
      const months = periodParts.months || [];
      const year = periodParts.year;
      const monthsCount = months.length || 1;
      const perMonth = amount / monthsCount;
      months.forEach(m => {
        const key = `${year}-${String(m).padStart(2, '0')}`;
        const rec = ensureMonth(key);
        rec.income += perMonth;
        const details = ensureDetails(key);
        details.incomes.push({
          date: `${String(m).padStart(2, '0')}/${year}`,
          tenantName: 'גג סולרי',
          account: '',
          method: '',
          amount: perMonth
        });
      });
      return;
    }

    const fallbackDate = item.createdAt || item.date;
    const iso = parseDateToIso(fallbackDate);
    if (!iso) return;
    const key = iso.slice(0, 7);
    const rec = ensureMonth(key);
    rec.income += amount;
    const details = ensureDetails(key);
    details.incomes.push({
      date: formatPeriodDisplay(item.period || '') || formatDateEu(iso),
      tenantName: 'גג סולרי',
      account: '',
      method: '',
      amount
    });
  });

  const readingsByTenantMeter = new Map();
  readings.forEach(r => {
    if (!r?.tenantId || !r?.meterType) return;
    const key = `${r.tenantId}|${r.meterType}`;
    if (!readingsByTenantMeter.has(key)) readingsByTenantMeter.set(key, []);
    readingsByTenantMeter.get(key).push(r);
  });
  readingsByTenantMeter.forEach(arr => {
    arr.sort((a, b) => dateValueFromAny(a.date) - dateValueFromAny(b.date));
  });

  readings
    .filter(r => !!r.paid)
    .forEach(r => {
      const iso = parseDateToIso(r.date);
      if (!iso) return;

      const keyByTenant = `${r.tenantId}|${r.meterType}`;
      const chain = readingsByTenantMeter.get(keyByTenant) || [];
      const currentDateValue = dateValueFromAny(r.date);
      if (Number.isNaN(currentDateValue)) return;

      const previous = chain
        .filter(item => item.id !== r.id && dateValueFromAny(item.date) < currentDateValue)
        .sort((a, b) => dateValueFromAny(b.date) - dateValueFromAny(a.date))[0];

      if (!previous) return;

      const consumption = Number(r.value || 0) - Number(previous.value || 0);
      let amount = 0;
      if (r.meterType === 'electricity') {
        amount = (kvaCon / 4) + (Math.max(0, consumption) * 0.65);
      } else if (r.meterType === 'water') {
        amount = Math.max(0, consumption) * waterPrice;
      }
      if (!amount) return;

      const monthKey = iso.slice(0, 7);
      const rec = ensureMonth(monthKey);
      rec.income += amount;

      const tenant = tenantMap.get(r.tenantId);
      const tenantName = tenant
        ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim()
        : (r.tenantName || '');

      const details = ensureDetails(monthKey);
      details.incomes.push({
        date: r.date,
        tenantName,
        account: 'קריאות',
        method: meterTypeLabel(r.meterType),
        amount
      });
    });

  expenses.forEach(e => {
    const amount = Number(e.amount || 0);
    if (!amount) return;
    const period = String(e.period || '').trim();
    const periodParts = parseExpensePeriod(period);

    if (periodParts) {
      const months = periodParts.months || [];
      const year = periodParts.year;
      const monthsCount = months.length || 1;
      const perMonth = amount / monthsCount;
      months.forEach(m => {
        const key = `${year}-${String(m).padStart(2, '0')}`;
        const rec = ensureMonth(key);
        rec.expense += perMonth;
        const details = ensureDetails(key);
        details.expenses.push({
          type: e.type,
          period: e.period || '',
          amount: perMonth
        });
      });
      return;
    }

    const fallbackDate = e.createdAt || e.date;
    const iso = parseDateToIso(fallbackDate);
    if (!iso) return;
    const key = iso.slice(0, 7);
    const rec = ensureMonth(key);
    rec.expense += amount;
    const details = ensureDetails(key);
    details.expenses.push({
      type: e.type,
      period: e.period || '',
      amount
    });
  });

  const keys = Array.from(monthly.keys()).sort();
  const hasMonthly = keys.length > 0;

  const parentPaymentsByMonth = new Map();
  payments
    .filter(p => accountValueFromCsv(p.account) === 'grandma')
    .forEach(p => {
      const iso = parseDateToIso(p.date);
      if (!iso) return;
      const key = iso.slice(0, 7);
      parentPaymentsByMonth.set(key, (parentPaymentsByMonth.get(key) || 0) + Number(p.amount || 0));
    });

  // Find the earliest and latest months
  const allMonths = [];
  
  // Add months from parentPeriods
  parentPeriods.forEach(p => {
    p.months.forEach(m => {
      allMonths.push(`${p.year}-${String(m).padStart(2, '0')}`);
    });
  });
  
  // Add months with actual payments
  parentPaymentsByMonth.forEach((_, key) => allMonths.push(key));
  
  // Add exempt months
  parentExemptSet.forEach(key => allMonths.push(key));

  // Add reduction months
  if (parentReductions && typeof parentReductions === 'object') {
    Object.keys(parentReductions).forEach(key => allMonths.push(key));
  }

  // Add reduction months
  if (parentReductions && typeof parentReductions === 'object') {
    Object.keys(parentReductions).forEach(key => allMonths.push(key));
  }
  
  let parentMonths = [];
  
  if (allMonths.length > 0) {
    allMonths.sort();
    const firstMonth = allMonths[0];
    
    // Calculate last month: one month after today's month
    const today = new Date();
    let todayYear = today.getFullYear();
    let todayMonth = today.getMonth() + 1; // getMonth() is 0-indexed
    
    // Add one month
    let lastMonthNum = todayMonth + 1;
    let lastYear = todayYear;
    if (lastMonthNum > 12) {
      lastMonthNum = 1;
      lastYear++;
    }
    
    const lastMonth = `${lastYear}-${String(lastMonthNum).padStart(2, '0')}`;
    
    // Generate all months between first and last
    const parentMonthSet = new Set();
    let [iterYear, iterMonth] = firstMonth.split('-').map(Number);
    const [endYear, endMonth] = lastMonth.split('-').map(Number);
    
    while (iterYear < endYear || (iterYear === endYear && iterMonth <= endMonth)) {
      parentMonthSet.add(`${iterYear}-${String(iterMonth).padStart(2, '0')}`);
      iterMonth++;
      if (iterMonth > 12) {
        iterMonth = 1;
        iterYear++;
      }
    }
    
    parentMonths = Array.from(parentMonthSet).sort();
  }

  let totalIncome = 0;
  let totalExpense = 0;

  // Use all months in the range (first to last month) instead of only months with data
  const displayMonths = keys.length > 0 ? keys : [];
  
  // Also ensure we display months up to lastMonth even if they have no data
  if (allMonths.length > 0 && hasMonthly) {
    // Generate full range of months between first and last
    const today = new Date();
    let todayYear = today.getFullYear();
    let todayMonth = today.getMonth() + 1;
    
    let lastMonthNum = todayMonth + 1;
    let lastYear = todayYear;
    if (lastMonthNum > 12) {
      lastMonthNum = 1;
      lastYear++;
    }
    
    const lastMonthForRange = `${lastYear}-${String(lastMonthNum).padStart(2, '0')}`;
    const firstMonthForRange = keys[0] || allMonths[0];
    
    const fullMonthRange = [];
    let [rangeYear, rangeMonth] = firstMonthForRange.split('-').map(Number);
    const [endRangeYear, endRangeMonth] = lastMonthForRange.split('-').map(Number);
    
    while (rangeYear < endRangeYear || (rangeYear === endRangeYear && rangeMonth <= endRangeMonth)) {
      fullMonthRange.push(`${rangeYear}-${String(rangeMonth).padStart(2, '0')}`);
      rangeMonth++;
      if (rangeMonth > 12) {
        rangeMonth = 1;
        rangeYear++;
      }
    }
    
    displayMonths.length = 0;
    displayMonths.push(...fullMonthRange);
  }

  const rows = displayMonths.length > 0 ? displayMonths.map(key => {
    const rec = monthly.get(key) || { income: 0, expense: 0 };
    const details = monthlyDetails.get(key) || { incomes: [], expenses: [] };
    const income = rec.income || 0;
    const expense = rec.expense || 0;
    const net = income - expense;
    totalIncome += income;
    totalExpense += expense;
    const monthLabel = `${key.slice(5, 7)}/${key.slice(0, 4)}`;
    const netColor = net >= 0 ? '#27ae60' : '#e74c3c';
    const typeLabels = {
      arnona1: 'ארנונה 1 (31/1)',
      arnona2: 'ארנונה 2 (31/2)',
      water: 'מים/ביוב',
      electricity: 'חשמל'
    };
    const incomeRows = details.incomes.length
      ? details.incomes.map(i => `
          <tr>
            <td>${formatDateEu(i.date)}</td>
            <td>${i.tenantName || '-'}</td>
            <td>${accountLabel(i.account) || '-'}</td>
            <td>${i.method || '-'}</td>
            <td style="direction: ltr; text-align: left;">₪${formatCurrency(i.amount)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#999;">אין הכנסות</td></tr>';
    const expenseRows = details.expenses.length
      ? details.expenses.map(ex => `
          <tr>
            <td>${typeLabels[ex.type] || ex.type || '-'}</td>
            <td>${formatPeriodDisplay(ex.period) || '-'}</td>
            <td style="direction: ltr; text-align: left;">₪${formatCurrency(ex.amount)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" style="text-align:center;color:#999;">אין הוצאות</td></tr>';
    return `
      <tr class="balance-month-row" data-month="${key}" style="cursor:pointer;">
        <td>${monthLabel}</td>
        <td style="direction: ltr; text-align: left;">₪${formatCurrency(income)}</td>
        <td style="direction: ltr; text-align: left;">₪${formatCurrency(expense)}</td>
        <td style="color:${netColor};font-weight:bold;direction: ltr; text-align: left;">₪${formatCurrency(net)}</td>
      </tr>
      <tr class="balance-detail-row hidden" data-month="${key}">
        <td colspan="4" style="padding: 12px 8px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
              <div style="font-weight: bold; margin-bottom: 6px;">הכנסות</div>
              <table class="payments-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>דייר</th>
                    <th>חשבון</th>
                    <th>אופן</th>
                    <th>סכום</th>
                  </tr>
                </thead>
                <tbody>
                  ${incomeRows}
                </tbody>
              </table>
            </div>
            <div>
              <div style="font-weight: bold; margin-bottom: 6px;">הוצאות</div>
              <table class="payments-table">
                <thead>
                  <tr>
                    <th>סוג</th>
                    <th>תקופה</th>
                    <th>סכום</th>
                  </tr>
                </thead>
                <tbody>
                  ${expenseRows}
                </tbody>
              </table>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="4" style="text-align:center;color:#999;">אין נתונים למאזן חודשי</td></tr>';

  const totalNet = totalIncome - totalExpense;
  const totalNetColor = totalNet >= 0 ? '#27ae60' : '#e74c3c';

  // Calculate net amounts for chart
  const netAmounts = displayMonths.map(key => {
    const rec = monthly.get(key) || { income: 0, expense: 0 };
    return (rec.income || 0) - (rec.expense || 0);
  });

  const maxNet = Math.max(...netAmounts.map(Math.abs), 1);
  const totalNetSum = netAmounts.reduce((sum, n) => sum + n, 0);
  const avgNet = displayMonths.length > 0 ? totalNetSum / displayMonths.length : 0;

  const chartBars = displayMonths.map((key, index) => {
    const rec = monthly.get(key) || { income: 0, expense: 0 };
    const net = (rec.income || 0) - (rec.expense || 0);
    const widthPct = maxNet > 0 ? Math.round((Math.abs(net) / maxNet) * 100) : 0;
    const label = `${key.slice(5, 7)}/${key.slice(0, 4)}`;
    const diffFromAvg = net - avgNet;
    const diffPct = avgNet !== 0 ? ((diffFromAvg / Math.abs(avgNet)) * 100).toFixed(1) : 0;
    const diffSymbol = diffFromAvg > 0 ? '▲' : (diffFromAvg < 0 ? '▼' : '=');
    const diffColor = diffFromAvg > 0 ? '#27ae60' : (diffFromAvg < 0 ? '#e74c3c' : '#666');
    const barColor = net >= 0 ? 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)' : 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
    const netColor = net >= 0 ? '#27ae60' : '#e74c3c';
    return `
      <div style="display: grid; grid-template-columns: 80px 1fr 120px 85px; gap: 12px; align-items: center;">
        <div style="font-size: 12px; color: #666;">${label}</div>
        <div style="height: 16px; background: #eef2f5; border-radius: 8px; overflow: hidden;">
          <div style="height: 100%; width: ${widthPct}%; background: ${barColor}; border-radius: 8px;"></div>
        </div>
        <div style="font-size: 12px; color: ${netColor}; text-align: right; direction: ltr; font-weight: 500;">₪${formatCurrency(net)}</div>
        <div style="font-size: 11px; color: ${diffColor}; text-align: center;">${diffSymbol} ${Math.abs(diffPct)}%</div>
      </div>
    `;
  }).join('');

  // Generate yearly aggregation
  const yearlyMap = new Map();
  displayMonths.forEach(key => {
    const year = Number(key.slice(0, 4));
    const rec = monthly.get(key) || { income: 0, expense: 0 };
    const net = (rec.income || 0) - (rec.expense || 0);
    if (!yearlyMap.has(year)) {
      yearlyMap.set(year, { income: 0, expense: 0, net: 0 });
    }
    const yearRec = yearlyMap.get(year);
    yearRec.income += rec.income || 0;
    yearRec.expense += rec.expense || 0;
    yearRec.net += net;
  });

  const yearlyEntries = Array.from(yearlyMap.entries()).sort((a, b) => a[0] - b[0]);
  const yearlyNetTotal = yearlyEntries.reduce((sum, [year, data]) => sum + data.net, 0);
  const yearlyNetAvg = yearlyEntries.length > 0 ? yearlyNetTotal / yearlyEntries.length : 0;
  const maxYearlyNet = yearlyEntries.reduce((max, [year, data]) => Math.max(max, Math.abs(data.net)), 0);

  const yearlyChartBars = yearlyEntries.map(([year, data]) => {
    const net = data.net;
    const widthPct = maxYearlyNet > 0 ? Math.round((Math.abs(net) / maxYearlyNet) * 100) : 0;
    const diffFromAvg = net - yearlyNetAvg;
    const diffPct = yearlyNetAvg !== 0 ? ((diffFromAvg / Math.abs(yearlyNetAvg)) * 100).toFixed(1) : 0;
    const diffSymbol = diffFromAvg > 0 ? '▲' : (diffFromAvg < 0 ? '▼' : '=');
    const diffColor = diffFromAvg > 0 ? '#27ae60' : (diffFromAvg < 0 ? '#e74c3c' : '#666');
    const barColor = net >= 0 ? 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)' : 'linear-gradient(135deg, #e67e22 0%, #d35400 100%)';
    const netColor = net >= 0 ? '#27ae60' : '#e74c3c';
    return `
      <div style="display: grid; grid-template-columns: 70px 1fr 130px 95px; gap: 12px; align-items: center;">
        <div style="font-size: 13px; font-weight: bold; color: #333;">${year}</div>
        <div style="height: 24px; background: #eef2f5; border-radius: 8px; overflow: hidden; position: relative;">
          <div style="height: 100%; width: ${widthPct}%; background: ${barColor}; border-radius: 8px;"></div>
        </div>
        <div style="font-size: 13px; color: ${netColor}; text-align: right; direction: ltr; font-weight: 600;">₪${formatCurrency(net)}</div>
        <div style="font-size: 11px; color: ${diffColor}; text-align: center;">${diffSymbol} ${Math.abs(diffPct)}%</div>
      </div>
    `;
  }).join('');

  const yearlyChartSection = yearlyEntries.length > 0 ? `
    <div style="margin-top: 30px; padding: 16px; background: #f9f9f9; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="font-weight: bold; font-size: 15px;">📊 נטו שנתי</div>
        <div style="font-size: 13px; color: #666;">
          ממוצע: <span style="font-weight: bold; color: ${yearlyNetAvg >= 0 ? '#27ae60' : '#e74c3c'};">₪${formatCurrency(yearlyNetAvg)}</span>
        </div>
      </div>
      <div style="display: grid; gap: 10px; padding-top: 8px;">
        ${yearlyChartBars}
      </div>
    </div>
  ` : '';

  let cumulativeBalance = 0;
  const parentRows = parentMonths.length ? parentMonths.map(key => {
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
    const balanceColor = balance >= 0 ? '#27ae60' : '#e74c3c';
    const cumulativeColor = cumulativeBalance >= 0 ? '#27ae60' : '#e74c3c';
    const label = `${key.slice(5, 7)}/${key.slice(0, 4)}`;
    const reasonWidth = Math.max(100, (reductionReason.length || 10) * 8);
    return `
      <tr>
        <td style="white-space:nowrap;">${label}</td>
        <td style="white-space:nowrap;">₪${formatCurrency(obligation)}</td>
        <td><input type="number" class="parent-reduction-amount" data-month="${key}" value="${reductionAmount}" style="width:70px;font-size:13px;padding:2px 4px;" step="0.01"></td>
        <td><input type="text" class="parent-reduction-reason" data-month="${key}" value="${reductionReason}" style="width:${reasonWidth}px;font-size:13px;padding:2px 4px;min-width:100px;"></td>
        <td style="white-space:nowrap;">₪${formatCurrency(paid)}</td>
        <td style="color:${balanceColor};font-weight:bold;white-space:nowrap;">₪${formatCurrency(balance)}</td>
        <td style="color:${cumulativeColor};font-weight:bold;white-space:nowrap;">₪${formatCurrency(cumulativeBalance)}</td>
        <td style="text-align:center;"><input class="parent-exempt-toggle" type="checkbox" data-month="${key}" ${isExempt ? 'checked' : ''}></td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:#999;">אין נתונים</td></tr>';

  list.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th>חודש</th>
          <th>הכנסות</th>
          <th>הוצאות</th>
          <th>נטו</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr style="font-weight: bold; border-top: 2px solid #333;">
          <td>סה"כ</td>
          <td style="direction: ltr; text-align: left;">₪${formatCurrency(totalIncome)}</td>
          <td style="direction: ltr; text-align: left;">₪${formatCurrency(totalExpense)}</td>
          <td style="color:${totalNetColor};direction: ltr; text-align: left;">₪${formatCurrency(totalNet)}</td>
        </tr>
      </tbody>
    </table>
    ${yearlyChartSection}
    <div style="margin-top: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="font-weight: bold;">גרף נטו חודשי</div>
        <div style="font-size: 13px; color: #666;">
          ממוצע: <span style="font-weight: bold; color: ${avgNet >= 0 ? '#27ae60' : '#e74c3c'};">₪${formatCurrency(avgNet)}</span>
        </div>
      </div>
      <div style="display: grid; gap: 8px; border-top: 1px solid #eee; padding-top: 12px;">
        ${chartBars}
      </div>
    </div>
  `;
}

document.getElementById('balance-list')?.addEventListener('click', e => {
  const row = e.target.closest('.balance-month-row');
  if (!row) return;
  const key = row.dataset.month;
  if (!key) return;
  
  // Remove selected class from all balance month rows
  document.querySelectorAll('.balance-month-row.selected').forEach(r => {
    r.classList.remove('selected');
  });
  
  // Add selected class to clicked row
  row.classList.add('selected');
  
  const detailRow = document.querySelector(`.balance-detail-row[data-month="${key}"]`);
  if (!detailRow) return;
  detailRow.classList.toggle('hidden');
});

document.getElementById('balance-list')?.addEventListener('change', async e => {
  const checkbox = e.target.closest('.parent-exempt-toggle');
  if (checkbox) {
    const key = checkbox.dataset.month;
    if (!key) return;
    const current = await getSetting('parentPaymentExemptMonths');
    const list = Array.isArray(current) ? current : [];
    const set = new Set(list);
    if (checkbox.checked) set.add(key); else set.delete(key);
    await setSetting('parentPaymentExemptMonths', Array.from(set));
    await renderBalance();
    return;
  }
  
  const reductionAmount = e.target.closest('.parent-reduction-amount');
  const reductionReason = e.target.closest('.parent-reduction-reason');
  
  if (reductionAmount || reductionReason) {
    const key = (reductionAmount || reductionReason).dataset.month;
    if (!key) return;
    const current = await getSetting('parentPaymentReductions');
    const reductions = current || {};
    if (!reductions[key]) reductions[key] = {};
    
    if (reductionAmount) {
      const value = Number(reductionAmount.value || 0);
      reductions[key].amount = value;
    } else if (reductionReason) {
      reductions[key].reason = reductionReason.value || '';
      // Auto-resize the input field
      const newWidth = Math.max(100, (reductionReason.value.length || 10) * 8);
      reductionReason.style.width = newWidth + 'px';
    }
    
    await setSetting('parentPaymentReductions', reductions);
    await renderBalance();
  }
});

// Render Mom View - separate view for parent payments
async function renderMom() {
  const momList = document.getElementById('mom-list');
  if (!momList) return;
  
  const payments = await getAllPayments();
  const parentDefaultRaw = await getSetting('parentPaymentDefault');
  const parentPeriodsText = await getSetting('parentPaymentPeriods');
  const parentExempt = await getSetting('parentPaymentExemptMonths');
  const parentReductionsRaw = await getSetting('parentPaymentReductions');
  
  const parentDefault = Number(parentDefaultRaw ?? 4400) || 0;
  const parentPeriods = parseParentPaymentPeriods(parentPeriodsText || '');
  const parentExemptSet = new Set(Array.isArray(parentExempt) ? parentExempt : []);
  const parentReductions = parentReductionsRaw || {};
  
  const parentPaymentsByMonth = new Map();
  payments
    .filter(p => accountValueFromCsv(p.account) === 'grandma')
    .forEach(p => {
      const iso = parseDateToIso(p.date);
      if (!iso) return;
      const key = iso.slice(0, 7);
      parentPaymentsByMonth.set(key, (parentPaymentsByMonth.get(key) || 0) + Number(p.amount || 0));
    });

  // Find months for parent payments
  const allMonths = [];
  parentPeriods.forEach(p => {
    p.months.forEach(m => {
      allMonths.push(`${p.year}-${String(m).padStart(2, '0')}`);
    });
  });
  parentPaymentsByMonth.forEach((_, key) => allMonths.push(key));
  parentExemptSet.forEach(key => allMonths.push(key));

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
  const parentRows = parentMonths.length ? parentMonths.map(key => {
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
    const balanceColor = balance >= 0 ? '#27ae60' : '#e74c3c';
    const cumulativeColor = cumulativeBalance >= 0 ? '#27ae60' : '#e74c3c';
    const label = `${key.slice(5, 7)}/${key.slice(0, 4)}`;
    const reasonWidth = Math.max(100, (reductionReason.length || 10) * 8);
    return `
      <tr>
        <td style="white-space:nowrap;">${label}</td>
        <td style="white-space:nowrap;direction: ltr; text-align: left;">₪${formatCurrency(obligation)}</td>
        <td><input type="number" class="parent-reduction-amount" data-month="${key}" value="${reductionAmount}" style="width:70px;font-size:13px;padding:2px 4px;" step="0.01"></td>
        <td><input type="text" class="parent-reduction-reason" data-month="${key}" value="${reductionReason}" style="width:${reasonWidth}px;font-size:13px;padding:2px 4px;min-width:100px;"></td>
        <td style="white-space:nowrap;direction: ltr; text-align: left;">₪${formatCurrency(paid)}</td>
        <td style="color:${balanceColor};font-weight:bold;white-space:nowrap;direction: ltr; text-align: left;">₪${formatCurrency(balance)}</td>
        <td style="color:${cumulativeColor};font-weight:bold;white-space:nowrap;direction: ltr; text-align: left;">₪${formatCurrency(cumulativeBalance)}</td>
        <td style="text-align:center;"><input class="parent-exempt-toggle" type="checkbox" data-month="${key}" ${isExempt ? 'checked' : ''}></td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:#999;">אין נתונים</td></tr>';

  momList.innerHTML = `
    <div style="margin-top: 24px;">
      <div style="font-weight: bold; margin-bottom: 8px;">תשלום לאסתר ומיכאל</div>
      <table class="payments-table">
        <thead>
          <tr>
            <th>חודש</th>
            <th>התחייבות</th>
            <th>הפחתה</th>
            <th>סיבה</th>
            <th>שולם</th>
            <th>מאזן</th>
            <th>עודף מצטבר</th>
            <th>פטור</th>
          </tr>
        </thead>
        <tbody>
          ${parentRows}
        </tbody>
      </table>
    </div>
  `;
  
  // Setup button listeners for mom view and table interactions
  setTimeout(() => {
    setupMomButtonListeners();
    setupParentPaymentTableListeners('mom-list');
  }, 0);
}

function setupParentPaymentTableListeners(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Toggle exempt checkbox
  container.querySelectorAll('.parent-exempt-toggle').forEach(checkbox => {
    checkbox.onchange = async () => {
      const month = checkbox.dataset.month;
      let exempt = await getSetting('parentPaymentExemptMonths');
      exempt = Array.isArray(exempt) ? exempt : [];
      
      if (checkbox.checked) {
        if (!exempt.includes(month)) exempt.push(month);
      } else {
        exempt = exempt.filter(m => m !== month);
      }
      
      await setSetting('parentPaymentExemptMonths', exempt);
      await renderMom();
    };
  });
  
  // Save reductions
  container.querySelectorAll('.parent-reduction-amount, .parent-reduction-reason').forEach(input => {
    input.onchange = async () => {
      const month = input.dataset.month;
      let reductions = await getSetting('parentPaymentReductions');
      reductions = reductions || {};
      
      const amountInput = container.querySelector(`.parent-reduction-amount[data-month="${month}"]`);
      const reasonInput = container.querySelector(`.parent-reduction-reason[data-month="${month}"]`);
      
      if (amountInput && amountInput.value) {
        if (!reductions[month]) reductions[month] = {};
        reductions[month].amount = parseFloat(amountInput.value) || 0;
      } else if (reasonInput && reasonInput.value) {
        if (!reductions[month]) reductions[month] = {};
        reductions[month].reason = reasonInput.value || '';
        const newWidth = Math.max(100, (reasonInput.value.length || 10) * 8);
        reasonInput.style.width = newWidth + 'px';
      }
      
      await setSetting('parentPaymentReductions', reductions);
      await renderMom();
    };
  });
}

function setupMomButtonListeners() {
  const exportCsvBtn = document.getElementById('mom-payments-export-csv');
  const importCsvBtn = document.getElementById('mom-payments-import-csv');
  const exportPdfBtn = document.getElementById('mom-payments-export-pdf');
  const clearAllBtn = document.getElementById('mom-payments-clear-all');
  
  if (exportCsvBtn) {
    exportCsvBtn.onclick = async () => {
      const exemptMonths = await getSetting('parentPaymentExemptMonths');
      const reductions = await getSetting('parentPaymentReductions');
      
      const exemptSet = new Set(Array.isArray(exemptMonths) ? exemptMonths : []);
      const allMonths = new Set();
      exemptSet.forEach(m => allMonths.add(m));
      if (reductions) Object.keys(reductions).forEach(m => allMonths.add(m));
      
      const rows = Array.from(allMonths).sort().map(month => {
        const isExempt = exemptSet.has(month);
        const reduction = reductions?.[month] || {};
        const amount = reduction.amount || 0;
        const reason = reduction.reason || '';
        return `${month},${isExempt ? 1 : 0},${amount},"${reason}"`;
      });
      
      const csv = 'Month,Exempt,ReductionAmount,ReductionReason\n' + rows.join('\n');
      await downloadCsv(csv, 'parent_payments.csv');
    };
  }
  
  if (importCsvBtn) {
    importCsvBtn.onclick = async () => {
      const file = document.getElementById('mom-payments-csv-upload').files[0];
      if (!file) { alert('בחר קובץ'); return; }
      
      const statusEl = document.getElementById('mom-payments-csv-status');
      if (statusEl) statusEl.textContent = 'מעבד...';
      
      try {
        const text = await readCsvWithEncoding(file);
        const lines = text.trim().split('\n');
        
        let imported = 0;
        const exemptMonths = [];
        const reductions = {};
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const match = line.match(/^(\d{4}-\d{2}),(\d+),([^,]*),(.*)$/);
          if (!match) continue;
          
          const month = match[1];
          const exempt = match[2] === '1';
          const amount = parseFloat(match[3]) || 0;
          const reason = match[4].replace(/^"|"$/g, '').trim();
          
          if (exempt) exemptMonths.push(month);
          if (amount > 0 || reason) {
            reductions[month] = { amount, reason };
          }
          imported++;
        }
        
        await setSetting('parentPaymentExemptMonths', exemptMonths);
        await setSetting('parentPaymentReductions', reductions);
        
        const msg = `יובאו ${imported} רשומות ✓`;
        if (statusEl) statusEl.textContent = msg;
        
        document.getElementById('mom-payments-csv-upload').value = '';
        await renderBalance();
        await renderMom();
      } catch (err) {
        if (statusEl) statusEl.textContent = `שגיאה: ${err.message}`;
      }
    };
  }
  
  if (exportPdfBtn) {
    exportPdfBtn.onclick = async () => {
      const statusEl = document.getElementById('mom-payments-csv-status');
      if (statusEl) statusEl.textContent = 'מייצא PDF...';
      try {
        console.log('PDF export button clicked');
        await exportParentPaymentsTableToPDF();
        console.log('PDF export completed');
        if (statusEl) statusEl.textContent = 'PDF נוצר בהצלחה ✓';
        setTimeout(() => {
          if (statusEl) statusEl.textContent = '';
        }, 3000);
      } catch (err) {
        console.error('PDF export failed:', err);
        if (statusEl) statusEl.textContent = `שגיאה: ${err.message}`;
      }
    };
  }
  
  if (clearAllBtn) {
    clearAllBtn.onclick = async () => {
      if (await confirmDialog('מחק את כל הפטור והפחתות?')) {
        await clearAllParentPaymentsData();
      }
    };
  }
}

// Auto-resize reason field while typing
document.getElementById('balance-list')?.addEventListener('input', e => {
  const reductionReason = e.target.closest('.parent-reduction-reason');
  if (reductionReason) {
    const newWidth = Math.max(100, (reductionReason.value.length || 10) * 8);
    reductionReason.style.width = newWidth + 'px';
  }
});

// Bind parent payment export buttons after renderBalance completes
// (Now done directly in renderBalance function above)

// Async function to export parent payments table to PDF
async function exportParentPaymentsTableToPDF() {
  console.log('Starting PDF export...');
  
  // Find the parent payments table
  let parentPaymentsTable = null;
  
  const momList = document.getElementById('mom-list');
  if (momList) {
    const tables = momList.querySelectorAll('table.payments-table');
    if (tables.length > 0) {
      parentPaymentsTable = tables[0];
      console.log('Found parent payments table in mom-list');
    }
  }
  
  if (!parentPaymentsTable) {
    const balanceList = document.getElementById('balance-list');
    if (balanceList) {
      const tables = balanceList.querySelectorAll('table.payments-table');
      if (tables.length > 0) {
        parentPaymentsTable = tables[tables.length - 1];
        console.log('Found parent payments table in balance-list');
      }
    }
  }
  
  if (!parentPaymentsTable) {
    throw new Error('טבלה לא נמצאה בעמוד');
  }
  
  const filename = `parent_payments_${new Date().toISOString().slice(0, 10)}.pdf`;
  
  try {
    // Try html2pdf first (most reliable)
    if (typeof html2pdf !== 'undefined' && html2pdf) {
      console.log('Using html2pdf for PDF export');
      
      const element = document.createElement('div');
      element.style.padding = '20px';
      element.style.direction = 'rtl';
      element.style.backgroundColor = 'white';
      
      // Add title
      const title = document.createElement('h2');
      title.textContent = 'דוח תשלומים';
      title.style.textAlign = 'center';
      title.style.marginBottom = '10px';
      element.appendChild(title);
      
      // Add date
      const dateP = document.createElement('p');
      dateP.textContent = 'לאסתר ומיכאל';
      dateP.style.textAlign = 'center';
      dateP.style.color = '#666';
      dateP.style.marginBottom = '5px';
      element.appendChild(dateP);
      
      const addressP = document.createElement('p');
      addressP.textContent = 'טרומפלדור 31, נהריה';
      addressP.style.textAlign = 'center';
      addressP.style.color = '#666';
      addressP.style.marginBottom = '20px';
      addressP.style.fontSize = '12px';
      element.appendChild(addressP);
      
      // Clone and add table
      const tableClone = parentPaymentsTable.cloneNode(true);
      tableClone.style.width = '100%';
      tableClone.style.borderCollapse = 'collapse';
      element.appendChild(tableClone);
      
      const worker = html2pdf().set({
        margin: [10, 10, 10, 10],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, logging: false },
        jsPDF: { orientation: 'landscape', unit: 'mm', format: 'a4' }
      }).from(element);
      const pdfBlob = await worker.outputPdf('blob');
      await saveBlobAs(pdfBlob, filename, 'application/pdf');
      
      console.log('PDF export completed with html2pdf');
      return;
    }
    
    // Fallback: try jsPDF
    console.log('html2pdf not available, trying jsPDF');
    
    if (typeof window.jsPDF === 'undefined') {
      console.error('jsPDF not available, attempting alternative export');
      throw new Error('לא ניתן לייצא PDF - אנא נסו שוב או טענו מחדש את הדף');
    }
    
    const jsPDFClass = window.jsPDF.jsPDF || window.jsPDF;
    if (!jsPDFClass) {
      throw new Error('ספריית PDF לא זמינה');
    }
    
    const pdf = new jsPDFClass('l', 'mm', 'a4');
    
    // Add formal header
    pdf.setFontSize(18);
    pdf.setFont(undefined, 'bold');
    pdf.text('דוח תשלומים', pdf.internal.pageSize.getWidth() / 2, 20, { align: 'center' });
    
    pdf.setFontSize(12);
    pdf.setFont(undefined, 'normal');
    pdf.text('לאסתר ומיכאל', pdf.internal.pageSize.getWidth() / 2, 28, { align: 'center' });
    
    // Add date and company info
    pdf.setFontSize(10);
    pdf.text('טרומפלדור 31, נהריה', pdf.internal.pageSize.getWidth() / 2, 35, { align: 'center' });
    pdf.text(`דו"ח משנת ${new Date().getFullYear()}`, pdf.internal.pageSize.getWidth() / 2, 41, { align: 'center' });
    
    // Extract table data
    const headers = [];
    const rows = [];
    
    // Get headers
    const headerCells = parentPaymentsTable.querySelectorAll('thead th');
    headerCells.forEach(th => {
      headers.push(th.textContent.trim());
    });
    
    // Get body rows
    const bodyRows = parentPaymentsTable.querySelectorAll('tbody tr');
    bodyRows.forEach(tr => {
      const row = [];
      const cells = tr.querySelectorAll('td');
      cells.forEach(td => {
        let text = td.textContent.trim();
        text = text.replace(/\s+/g, ' ').trim();
        row.push(text);
      });
      if (row.some(cell => cell.length > 0)) {
        rows.push(row);
      }
    });
    
    console.log('Extracted', rows.length, 'rows');
    
    // Use autoTable if available
    if (pdf.autoTable && typeof pdf.autoTable === 'function') {
      console.log('Using autoTable for professional table');
      pdf.autoTable({
        head: [headers],
        body: rows,
        startY: 50,
        theme: 'grid',
        styles: {
          fontSize: 9,
          textColor: [0, 0, 0],
          halign: 'right'
        },
        headStyles: {
          fillColor: [43, 108, 176],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'right',
          valign: 'middle'
        },
        bodyStyles: {
          halign: 'right'
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245]
        },
        columnStyles: {
          0: { halign: 'center' }
        },
        margin: { top: 50, right: 10, bottom: 20, left: 10 }
      });
    } else {
      // Fallback: manual table rendering
      console.log('Using manual table rendering (autoTable not available)');
      
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 10;
      const contentWidth = pageWidth - (2 * margin);
      const colWidth = contentWidth / headers.length;
      
      let yPosition = 50;
      const lineHeight = 7;
      
      // Draw headers
      pdf.setFillColor(43, 108, 176);
      pdf.setTextColor(255, 255, 255);
      pdf.setFont(undefined, 'bold');
      pdf.setFontSize(9);
      
      headers.forEach((header, col) => {
        const x = margin + (col * colWidth);
        pdf.rect(x, yPosition, colWidth, lineHeight, 'F');
        pdf.text(header, x + 1, yPosition + lineHeight - 1.5, { maxWidth: colWidth - 2, align: 'right' });
      });
      
      yPosition += lineHeight;
      
      // Draw rows
      pdf.setTextColor(0, 0, 0);
      pdf.setFont(undefined, 'normal');
      let rowIndex = 0;
      
      rows.forEach(row => {
        if (yPosition > pdf.internal.pageSize.getHeight() - margin) {
          pdf.addPage();
          yPosition = margin;
        }
        
        // Alternate row colors
        if (rowIndex % 2 === 1) {
          pdf.setFillColor(245, 245, 245);
          pdf.rect(margin, yPosition, contentWidth, lineHeight, 'F');
        }
        pdf.setDrawColor(200, 200, 200);
        
        row.forEach((cell, col) => {
          const x = margin + (col * colWidth);
          pdf.rect(x, yPosition, colWidth, lineHeight);
          pdf.text(String(cell), x + 1, yPosition + lineHeight - 1.5, { 
            maxWidth: colWidth - 2,
            align: 'right'
          });
        });
        
        yPosition += lineHeight;
        rowIndex++;
      });
    }
    
    // Add footer
    const pageCount = pdf.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(
        `עמוד ${i} מתוך ${pageCount}`,
        pdf.internal.pageSize.getWidth() / 2,
        pdf.internal.pageSize.getHeight() - 5,
        { align: 'center' }
      );
    }
    
    const pdfBlob = pdf.output('blob');
    await saveBlobAs(pdfBlob, filename, 'application/pdf');
    console.log('PDF export completed with jsPDF');
    
  } catch (err) {
    console.error('PDF export error:', err);
    throw err;
  }
}

// Keep this comment for reference - event listeners moved to renderBalance()

async function populateTenantSelects(includeArchived = false, target = 'both', ensureTenantId = null) {
  const tenants = isRemoteApp()
    ? await getAllTenantsRemote(includeArchived)
    : await getAllTenants(includeArchived);
  const tenantsForSelect = tenants.slice();
  if (ensureTenantId) {
    const exists = tenantsForSelect.some(t => Number(t.id) === Number(ensureTenantId));
    if (!exists) {
      const ensuredTenant = isRemoteApp()
        ? await getTenantByIdRemote(Number(ensureTenantId))
        : await getTenantById(Number(ensureTenantId));
      if (ensuredTenant) tenantsForSelect.unshift(ensuredTenant);
    }
  }
  const selects = target === 'payment'
    ? [document.getElementById('payment-tenant')]
    : target === 'reading'
      ? [document.getElementById('reading-tenant')]
      : [document.getElementById('reading-tenant'), document.getElementById('payment-tenant')];

  selects.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '<option value="">בחר דייר</option>';
    tenantsForSelect.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.apartmentNumber || '-'}: ${t.firstName}`;
      sel.appendChild(opt);
    });
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
  if (isRemoteApp()) {
    return await addExpenseRemote(data);
  }
  const tx = await getTx('expenses', 'readwrite');
  if (data.paid === undefined) data.paid = false;
  data.paid = !!data.paid;
  data.createdAt = new Date().toISOString();
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').add(data);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function deleteExpense(id) {
  if (isRemoteApp()) {
    return await deleteExpenseRemote(id);
  }
  const tx = await getTx('expenses', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function updateExpense(id, data) {
  if (isRemoteApp()) {
    return await updateExpenseRemote(id, data);
  }
  const tx = await getTx('expenses', 'readwrite');
  data.id = id;
  data.createdAt = new Date().toISOString();
  if (!data.period) data.period = '';
  if (!data.frequency) data.frequency = '';
  if (data.paid === undefined) data.paid = false;
  data.paid = !!data.paid;
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').put(data);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function getAllExpenses() {
  if (isRemoteApp()) {
    return await getAllExpensesRemote();
  }
  const tx = await getTx('expenses', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').getAll();
    r.onsuccess = () => res((r.result || []).sort((a, b) => new Date(b.date) - new Date(a.date)));
    r.onerror = () => rej(r.error);
  });
}

async function clearAllExpenses() {
  if (isRemoteApp()) {
    await apiRequest('/api/expenses', { method: 'DELETE' });
    return;
  }
  const tx = await getTx('expenses', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('expenses').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function addExpenseRemote(data) {
  const payload = {
    type: data.type || '',
    period: data.period || '',
    amount: data.amount ?? null,
    frequency: data.frequency || '',
    date: data.date || '',
    paid: !!data.paid
  };
  return await apiRequest('/api/expenses', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function updateExpenseRemote(id, data) {
  const payload = {
    type: data.type || '',
    period: data.period || '',
    amount: data.amount ?? null,
    frequency: data.frequency || '',
    date: data.date || '',
    paid: !!data.paid
  };
  return await apiRequest(`/api/expenses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

async function deleteExpenseRemote(id) {
  await apiRequest(`/api/expenses/${id}`, { method: 'DELETE' });
}

async function getAllExpensesRemote() {
  const rows = await apiRequest('/api/expenses');
  return (rows || []).map(row => ({ ...row, paid: !!row.paid }));
}

async function expenseExists(expense) {
  const expenses = await getAllExpenses();
  return expenses.some(e => 
    e.type === expense.type &&
    e.period === (expense.period || '') &&
    e.amount === expense.amount &&
    e.frequency === (expense.frequency || '')
  );
}

function parsePaidCsvValue(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return false;
  return ['1', 'true', 'yes', 'y', 'כן'].includes(value);
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
    const frequency = e.frequency ? `${e.frequency === 'yearly' ? 'שנתי' : 'דו-חודשי'}` : '';
    const period = formatPeriodDisplay(e.period || '');
    return `
      <tr>
        <td>${typeLabels[e.type] || e.type}</td>
        <td>${period}</td>
        <td>${frequency}</td>
        <td style="direction: ltr; text-align: left;">₪${formatCurrency(e.amount || 0)}</td>
        <td><button class="btn-edit-expense" data-id="${e.id}" style="margin-right: 5px;">✏️</button><button class="btn-delete-expense" data-id="${e.id}">🗑️</button></td>
      </tr>
    `;
  }).join('');
  
  listEl.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th>סוג</th>
          <th>תקופה</th>
          <th>תדירות</th>
          <th>סכום</th>
          <th>פעולות</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr style="font-weight: bold; border-top: 2px solid #333;">
          <td colspan="3">סה"כ:</td>
          <td style="direction: ltr; text-align: left;">₪${formatCurrency(total)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `;
}

// Solar roof income functions
async function addSolarIncome(data) {
  if (isRemoteApp()) {
    return await addSolarIncomeRemote(data);
  }
  const tx = await getTx('solar', 'readwrite');
  data.createdAt = new Date().toISOString();
  return new Promise((res, rej) => {
    const r = tx.objectStore('solar').add(data);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function updateSolarIncome(id, data) {
  if (isRemoteApp()) {
    return await updateSolarIncomeRemote(id, data);
  }
  const tx = await getTx('solar', 'readwrite');
  data.id = id;
  data.createdAt = new Date().toISOString();
  return new Promise((res, rej) => {
    const r = tx.objectStore('solar').put(data);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function deleteSolarIncome(id) {
  if (isRemoteApp()) {
    return await deleteSolarIncomeRemote(id);
  }
  const tx = await getTx('solar', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('solar').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function clearAllSolarIncome() {
  if (isRemoteApp()) {
    await apiRequest('/api/solar', { method: 'DELETE' });
    return;
  }
  const tx = await getTx('solar', 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore('solar').clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function getAllSolarIncome() {
  if (isRemoteApp()) {
    return await getAllSolarIncomeRemote();
  }
  const tx = await getTx('solar', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('solar').getAll();
    r.onsuccess = () => res((r.result || []).sort((a, b) => String(b.period || '').localeCompare(String(a.period || ''))));
    r.onerror = () => rej(r.error);
  });
}

async function addSolarIncomeRemote(data) {
  const payload = {
    period: data.period || '',
    amount: data.amount ?? null,
    date: data.date || ''
  };
  return await apiRequest('/api/solar', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function updateSolarIncomeRemote(id, data) {
  const payload = {
    period: data.period || '',
    amount: data.amount ?? null,
    date: data.date || ''
  };
  return await apiRequest(`/api/solar/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

async function deleteSolarIncomeRemote(id) {
  await apiRequest(`/api/solar/${id}`, { method: 'DELETE' });
}

async function getAllSolarIncomeRemote() {
  const rows = await apiRequest('/api/solar');
  return rows || [];
}

function normalizeSolarPeriod(period) {
  const formatted = formatPeriodDisplay(period);
  return formatted || String(period || '').trim();
}

async function solarIncomeExists(entry, excludeId = null) {
  const items = await getAllSolarIncome();
  const periodKey = normalizeSolarPeriod(entry.period);
  const amount = Number(entry.amount || 0);
  return items.some(i => {
    if (excludeId !== null && i.id === excludeId) return false;
    const itemPeriod = normalizeSolarPeriod(i.period);
    const itemAmount = Number(i.amount || 0);
    return itemPeriod === periodKey && itemAmount === amount;
  });
}

async function renderSolarIncome() {
  const items = await getAllSolarIncome();
  const listEl = document.getElementById('solar-list');
  if (!listEl) return;
  if (items.length === 0) {
    listEl.innerHTML = '<p>אין הכנסות</p>';
    return;
  }

  // Helper function to extract start date for sorting
  function extractSortKey(period) {
    const raw = String(period || '').trim();
    const parts = raw.match(/\d+/g) || [];
    if (parts.length === 0) return '999999';
    const yearPart = parts.find(p => p.length === 4) || parts[parts.length - 1];
    const year = Number(yearPart);
    const monthParts = parts.filter(p => p !== yearPart).map(n => Number(n)).filter(n => !Number.isNaN(n));
    const startMonth = monthParts.length > 0 ? monthParts[0] : 1;
    return `${year}${String(startMonth).padStart(2, '0')}`;
  }

  // Sort items by period (year-month)
  const sortedItems = [...items].sort((a, b) => {
    const keyA = extractSortKey(a.period);
    const keyB = extractSortKey(b.period);
    return keyA.localeCompare(keyB);
  });

  let total = 0;
  const rows = sortedItems.map(item => {
    total += Number(item.amount || 0);
    return `
      <tr>
        <td>${formatPeriodDisplay(item.period) || '-'}</td>
        <td style="direction: ltr; text-align: left;">₪${formatCurrency(item.amount || 0)}</td>
        <td><button class="btn-edit-solar" data-id="${item.id}" style="margin-right: 5px;">✏️</button><button class="btn-delete-solar" data-id="${item.id}">🗑️</button></td>
      </tr>
    `;
  }).join('');

  // Generate chart bars (monthly) with average and percentage
  const maxAmount = sortedItems.reduce((max, item) => Math.max(max, Number(item.amount || 0)), 0);
  const monthlyTotal = sortedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const monthlyAvg = sortedItems.length > 0 ? monthlyTotal / sortedItems.length : 0;
  
  const chartBars = sortedItems.map(item => {
    const amount = Number(item.amount || 0);
    const widthPct = maxAmount > 0 ? Math.round((amount / maxAmount) * 100) : 0;
    const label = formatPeriodDisplay(item.period) || '-';
    const diffFromAvg = amount - monthlyAvg;
    const diffPct = monthlyAvg > 0 ? ((diffFromAvg / monthlyAvg) * 100).toFixed(1) : 0;
    const diffSymbol = diffFromAvg > 0 ? '▲' : (diffFromAvg < 0 ? '▼' : '=');
    const diffColor = diffFromAvg > 0 ? '#27ae60' : (diffFromAvg < 0 ? '#e74c3c' : '#666');
    return `
      <div style="display: grid; grid-template-columns: 100px 1fr 120px 85px; gap: 12px; align-items: center;">
        <div style="font-size: 12px; color: #666;">${label}</div>
        <div style="height: 16px; background: #eef2f5; border-radius: 8px; overflow: hidden;">
          <div style="height: 100%; width: ${widthPct}%; background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); border-radius: 8px;"></div>
        </div>
        <div style="font-size: 12px; color: #333; text-align: right; direction: ltr; font-weight: 500;">₪${formatCurrency(amount)}</div>
        <div style="font-size: 11px; color: ${diffColor}; text-align: center;">${diffSymbol} ${Math.abs(diffPct)}%</div>
      </div>
    `;
  }).join('');

  // Generate yearly aggregation
  const yearlyMap = new Map();
  sortedItems.forEach(item => {
    const period = String(item.period || '').trim();
    const parts = period.match(/\d+/g) || [];
    const yearPart = parts.find(p => p.length === 4);
    if (!yearPart) return;
    const year = Number(yearPart);
    const amount = Number(item.amount || 0);
    yearlyMap.set(year, (yearlyMap.get(year) || 0) + amount);
  });

  const yearlyEntries = Array.from(yearlyMap.entries()).sort((a, b) => a[0] - b[0]);
  const yearlyTotal = yearlyEntries.reduce((sum, [year, amount]) => sum + amount, 0);
  const yearlyAvg = yearlyEntries.length > 0 ? yearlyTotal / yearlyEntries.length : 0;
  const maxYearlyAmount = yearlyEntries.reduce((max, [year, amount]) => Math.max(max, amount), 0);

  const yearlyChartBars = yearlyEntries.map(([year, amount]) => {
    const widthPct = maxYearlyAmount > 0 ? Math.round((amount / maxYearlyAmount) * 100) : 0;
    const diffFromAvg = amount - yearlyAvg;
    const diffPct = yearlyAvg > 0 ? ((diffFromAvg / yearlyAvg) * 100).toFixed(1) : 0;
    const diffSymbol = diffFromAvg > 0 ? '▲' : (diffFromAvg < 0 ? '▼' : '=');
    const diffColor = diffFromAvg > 0 ? '#27ae60' : (diffFromAvg < 0 ? '#e74c3c' : '#666');
    return `
      <div style="display: grid; grid-template-columns: 70px 1fr 130px 95px; gap: 12px; align-items: center;">
        <div style="font-size: 13px; font-weight: bold; color: #333;">${year}</div>
        <div style="height: 24px; background: #eef2f5; border-radius: 8px; overflow: hidden; position: relative;">
          <div style="height: 100%; width: ${widthPct}%; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); border-radius: 8px;"></div>
        </div>
        <div style="font-size: 13px; color: #333; text-align: right; direction: ltr; font-weight: 600;">₪${formatCurrency(amount)}</div>
        <div style="font-size: 11px; color: ${diffColor}; text-align: center;">${diffSymbol} ${Math.abs(diffPct)}%</div>
      </div>
    `;
  }).join('');

  const yearlyChartSection = yearlyEntries.length > 0 ? `
    <div style="margin-top: 30px; padding: 16px; background: #f9f9f9; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="font-weight: bold; font-size: 15px;">📊 הכנסות שנתיות</div>
        <div style="font-size: 13px; color: #666;">
          ממוצע: <span style="font-weight: bold; color: #333;">₪${formatCurrency(yearlyAvg)}</span>
        </div>
      </div>
      <div style="display: grid; gap: 10px; padding-top: 8px;">
        ${yearlyChartBars}
      </div>
    </div>
  ` : '';

  listEl.innerHTML = `
    <table class="payments-table">
      <thead>
        <tr>
          <th>תקופה</th>
          <th>סכום</th>
          <th>פעולות</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr style="font-weight: bold; border-top: 2px solid #333;">
          <td>סה"כ:</td>
          <td style="direction: ltr; text-align: left;">₪${formatCurrency(total)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    ${yearlyChartSection}
    <div style="margin-top: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="font-weight: bold;">גרף הכנסות חודשי</div>
        <div style="font-size: 13px; color: #666;">
          ממוצע: <span style="font-weight: bold; color: #333;">₪${formatCurrency(monthlyAvg)}</span>
        </div>
      </div>
      <div style="display: grid; gap: 8px; border-top: 1px solid #eee; padding-top: 12px;">
        ${chartBars}
      </div>
    </div>
  `;
}

const expensesView = document.getElementById('expenses-view');
const solarView = document.getElementById('solar-view');

// Helper function to set active button
function setActiveButton(buttonId) {
  const buttons = document.querySelectorAll('.controls button');
  buttons.forEach(btn => btn.classList.remove('active-btn'));
  const activeBtn = document.getElementById(buttonId);
  if (activeBtn) activeBtn.classList.add('active-btn');
}

// Actions
const showAddBtn = document.getElementById('show-add');
const showArchiveBtn = document.getElementById('show-archive');
const showSettingsBtn = document.getElementById('show-settings');
const showReadingsBtn = document.getElementById('show-readings');
const showPaymentsBtn = document.getElementById('show-payments');
const showRemindersBtn = document.getElementById('show-reminders');
const showExpensesBtn = document.getElementById('show-expenses');
const showSolarBtn = document.getElementById('show-solar');
const showBalanceBtn = document.getElementById('show-balance');

showAddBtn?.addEventListener('click', async () => { setActiveButton('show-add'); show(tenantForm); tenantForm.editId = null; document.getElementById('form-title').textContent = 'הוספת דייר'; tenantForm.reset(); await renderTenantsTable(); });
showArchiveBtn?.addEventListener('click', async () => { setActiveButton('show-archive'); await renderArchive(); show(archiveView); });
showSettingsBtn?.addEventListener('click', async () => { 
  setActiveButton('show-settings');
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
  setActiveButton('show-payments');
  await populateTenantSelects();
  if (paymentForm) paymentForm.reset();
  resetPaymentFormMode();
  await renderPayments();
  show(paymentsView);
});
showRemindersBtn?.addEventListener('click', async () => {
  setActiveButton('show-reminders');
  await renderReminders();
  show(remindersView);
});
showBalanceBtn?.addEventListener('click', async () => {
  setActiveButton('show-balance');
  const checkbox = document.getElementById('balance-include-solar');
  if (checkbox) {
    const saved = await getSetting('balanceIncludeSolar');
    checkbox.checked = saved === undefined ? true : !!saved;
  }
  await renderBalance();
  show(balanceView);
});

document.getElementById('balance-include-solar')?.addEventListener('change', async e => {
  await setSetting('balanceIncludeSolar', e.target.checked);
  await renderBalance();
});

showExpensesBtn?.addEventListener('click', async () => { 
  setActiveButton('show-expenses');
  await renderExpenses();
  show(expensesView);
});
showSolarBtn?.addEventListener('click', async () => {
  setActiveButton('show-solar');
  await renderSolarIncome();
  show(solarView);
});
const showMomBtn = document.getElementById('show-mom');
showMomBtn?.addEventListener('click', async () => {
  setActiveButton('show-mom');
  await renderMom();
  show(document.getElementById('mom-view'));
});

showReadingsBtn?.addEventListener('click', async () => {
  setActiveButton('show-readings');
  const tenants = await getAllTenants(false);
  const readings = await getAllReadings();
  const latestElectricityByTenant = buildLatestReadingMap(readings, 'electricity');
  const latestWaterByTenant = buildLatestReadingMap(readings, 'water');
  const sortedElec = sortTenantsByMeter(tenants, 'electricityMeter');
  const sortedWater = sortTenantsByMeter(tenants, 'waterMeter');
  buildBulkList('bulk-electricity-list', sortedElec, 'electricityMeter', 'קוט"ש', latestElectricityByTenant);
  buildBulkList('bulk-water-list', sortedWater, 'waterMeter', 'מ"ק', latestWaterByTenant);
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

document.getElementById('save-reminders-settings')?.addEventListener('click', async () => {
  if (!canWriteCurrentUser()) return;
  const contractDaysRaw = Number(document.getElementById('reminders-contract-days')?.value || REMINDER_DEFAULTS.contractDays);
  const checkDaysRaw = Number(document.getElementById('reminders-check-days')?.value || REMINDER_DEFAULTS.checkDays);
  const contractDays = Number.isFinite(contractDaysRaw) && contractDaysRaw > 0 ? Math.floor(contractDaysRaw) : REMINDER_DEFAULTS.contractDays;
  const checkDays = Number.isFinite(checkDaysRaw) && checkDaysRaw > 0 ? Math.floor(checkDaysRaw) : REMINDER_DEFAULTS.checkDays;
  await setSetting('remindersConfig', { contractDays, checkDays });
  await renderReminders();
});

document.getElementById('add-manual-reminder')?.addEventListener('click', async () => {
  if (!canWriteCurrentUser()) return;
  const textEl = document.getElementById('manual-reminder-text');
  const dueEl = document.getElementById('manual-reminder-due');
  const text = String(textEl?.value || '').trim();
  if (!text) {
    alert('יש להזין תוכן תזכורת');
    return;
  }
  const dueDate = parseDateToIso(dueEl?.value || '');
  const current = await getManualReminders();
  current.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    dueDate,
    done: false,
    createdAt: new Date().toISOString()
  });
  await setManualReminders(current);
  if (textEl) textEl.value = '';
  if (dueEl) dueEl.value = '';
  await renderReminders();
});

document.getElementById('enable-browser-notifications')?.addEventListener('click', async () => {
  if (typeof Notification === 'undefined') {
    alert('הדפדפן לא תומך בהתראות');
    return;
  }
  if (Notification.permission === 'granted') {
    alert('התראות כבר פעילות');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    alert('התראות דפדפן הופעלו בהצלחה');
    await setSetting('lastRemindersNotifyDate', '');
    await renderReminders();
  } else {
    alert('לא ניתן להפעיל התראות דפדפן ללא אישור');
  }
});

document.getElementById('reminders-list')?.addEventListener('click', async e => {
  const markPaidBtn = e.target.closest('.btn-mark-reading-paid');
  if (markPaidBtn) {
    if (!canWriteCurrentUser()) return;
    const readingId = Number(markPaidBtn.dataset.readingId || 0);
    if (!readingId) return;
    await updateReading(readingId, { paid: true });
    if (readingsView && !readingsView.classList.contains('hidden')) {
      await renderReadings();
    }
    await renderReminders();
    return;
  }

  const releaseAutoBtn = e.target.closest('.btn-release-auto-reminder');
  if (releaseAutoBtn) {
    if (!canWriteCurrentUser()) return;
    const targetId = String(releaseAutoBtn.dataset.id || '');
    if (!targetId) return;
    const current = await getReleasedAutoReminderIds();
    current.push(targetId);
    await setReleasedAutoReminderIds(current);
    await renderReminders();
    return;
  }

  const restoreAutoBtn = e.target.closest('.btn-restore-auto-reminder');
  if (restoreAutoBtn) {
    if (!canWriteCurrentUser()) return;
    const targetId = String(restoreAutoBtn.dataset.id || '');
    if (!targetId) return;
    const current = await getReleasedAutoReminderIds();
    const next = current.filter(id => String(id) !== targetId);
    await setReleasedAutoReminderIds(next);
    await renderReminders();
    return;
  }

  const toggleBtn = e.target.closest('.btn-toggle-manual-reminder');
  if (toggleBtn) {
    if (!canWriteCurrentUser()) return;
    const targetId = String(toggleBtn.dataset.id || '');
    const current = await getManualReminders();
    const next = current.map(item => item.id === targetId ? { ...item, done: !item.done } : item);
    await setManualReminders(next);
    await renderReminders();
    return;
  }

  const deleteBtn = e.target.closest('.btn-delete-manual-reminder');
  if (deleteBtn) {
    if (!canWriteCurrentUser()) return;
    const targetId = String(deleteBtn.dataset.id || '');
    const ok = await confirmDialog('למחוק את התזכורת?');
    if (!ok) return;
    const current = await getManualReminders();
    const next = current.filter(item => item.id !== targetId);
    await setManualReminders(next);
    await renderReminders();
  }
});

// Close buttons
document.getElementById('cancel')?.addEventListener('click', () => show(tenantForm));

// Expenses form
document.getElementById('save-expense')?.addEventListener('click', async () => {
  const editId = expensesView?.dataset?.editId;
  let existingPaid = false;
  if (editId) {
    const expenses = await getAllExpenses();
    const existing = expenses.find(ex => ex.id === Number(editId));
    existingPaid = !!existing?.paid;
  }
  const arnona1 = parseFloat(document.getElementById('expense-arnona1').value) || 0;
  const arnona1Freq = document.getElementById('expense-arnona1-frequency').value;
  const arnona1Period = document.getElementById('expense-arnona1-period').value.trim();
  const arnona2 = parseFloat(document.getElementById('expense-arnona2').value) || 0;
  const arnona2Freq = document.getElementById('expense-arnona2-frequency').value;
  const arnona2Period = document.getElementById('expense-arnona2-period').value.trim();
  const water = parseFloat(document.getElementById('expense-water').value) || 0;
  const waterPeriod = document.getElementById('expense-water-period').value.trim();
  const electricity = parseFloat(document.getElementById('expense-electricity').value) || 0;
  const electricityPeriod = document.getElementById('expense-electricity-period').value.trim();
  
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
  
  if (editId) {
    // Edit mode - update single expense
    const id = Number(editId);
    if (arnona1 > 0) {
      const expense1 = {
        period: arnona1Period,
        type: 'arnona1',
        amount: arnona1,
        frequency: arnona1Freq,
        paid: existingPaid
      };
      await updateExpense(id, expense1);
    } else if (arnona2 > 0) {
      const expense2 = {
        period: arnona2Period,
        type: 'arnona2',
        amount: arnona2,
        frequency: arnona2Freq,
        paid: existingPaid
      };
      await updateExpense(id, expense2);
    } else if (water > 0) {
      const expenseWater = {
        period: waterPeriod,
        type: 'water',
        amount: water,
        paid: existingPaid
      };
      await updateExpense(id, expenseWater);
    } else if (electricity > 0) {
      const expenseElec = {
        period: electricityPeriod,
        type: 'electricity',
        amount: electricity,
        paid: existingPaid
      };
      await updateExpense(id, expenseElec);
    }
    delete expensesView.dataset.editId;
  } else {
    // Add mode - save each expense separately
    let saved = 0;
    if (arnona1 > 0) {
      const expense1 = {
        period: arnona1Period,
        type: 'arnona1',
        amount: arnona1,
        frequency: arnona1Freq,
        paid: false
      };
      if (!(await expenseExists(expense1))) {
        await addExpense(expense1);
        saved++;
      }
    }
    if (arnona2 > 0) {
      const expense2 = {
        period: arnona2Period,
        type: 'arnona2',
        amount: arnona2,
        frequency: arnona2Freq,
        paid: false
      };
      if (!(await expenseExists(expense2))) {
        await addExpense(expense2);
        saved++;
      }
    }
    if (water > 0) {
      const expenseWater = {
        period: waterPeriod,
        type: 'water',
        amount: water,
        paid: false
      };
      if (!(await expenseExists(expenseWater))) {
        await addExpense(expenseWater);
        saved++;
      }
    }
    if (electricity > 0) {
      const expenseElec = {
        period: electricityPeriod,
        type: 'electricity',
        amount: electricity,
        paid: false
      };
      if (!(await expenseExists(expenseElec))) {
        await addExpense(expenseElec);
        saved++;
      }
    }
    
    if (saved === 0) {
      alert('כל ההוצאות שלא הוכנסו - כבר קיימות בנתונים');
    }
  }
  
  document.getElementById('expense-arnona1').value = '';
  document.getElementById('expense-arnona1-frequency').value = 'bimonthly';
  document.getElementById('expense-arnona1-period').value = '';
  document.getElementById('expense-arnona2').value = '';
  document.getElementById('expense-arnona2-frequency').value = 'bimonthly';
  document.getElementById('expense-arnona2-period').value = '';
  document.getElementById('expense-water').value = '';
  document.getElementById('expense-water-period').value = '';
  document.getElementById('expense-electricity').value = '';
  document.getElementById('expense-electricity-period').value = '';
  
  await renderExpenses();
});

document.getElementById('expenses-list')?.addEventListener('click', async e => {
  const editBtn = e.target.closest('.btn-edit-expense');
  const delBtn = e.target.closest('.btn-delete-expense');
  
  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    const expenses = await getAllExpenses();
    const expense = expenses.find(ex => ex.id === id);
    if (!expense) return;
    
    // Load data into form
    if (expense.type === 'arnona1') {
      document.getElementById('expense-arnona1').value = expense.amount;
      document.getElementById('expense-arnona1-frequency').value = expense.frequency || 'bimonthly';
      document.getElementById('expense-arnona1-period').value = expense.period || '';
    } else if (expense.type === 'arnona2') {
      document.getElementById('expense-arnona2').value = expense.amount;
      document.getElementById('expense-arnona2-frequency').value = expense.frequency || 'bimonthly';
      document.getElementById('expense-arnona2-period').value = expense.period || '';
    } else if (expense.type === 'water') {
      document.getElementById('expense-water').value = expense.amount;
      document.getElementById('expense-water-period').value = expense.period || '';
    } else if (expense.type === 'electricity') {
      document.getElementById('expense-electricity').value = expense.amount;
      document.getElementById('expense-electricity-period').value = expense.period || '';
    }
    
    // Set edit mode
    expensesView.dataset.editId = id;
    return;
  }
  
  if (delBtn) {
    const id = Number(delBtn.dataset.id);
    if (await confirmDialog('מחק את ההוצאה?')) {
      await deleteExpense(id);
      await renderExpenses();
    }
  }
});

// Expenses CSV
document.getElementById('expenses-export-csv')?.addEventListener('click', async () => {
  const expenses = await getAllExpenses();
  const csv = 'Type,Period,Amount,Frequency\n' + 
    expenses.map(e => `${e.type},${e.period||''},${e.amount||0},${e.frequency||''}`).join('\n');
  await downloadCsv(csv, 'expenses.csv');
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
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 2 && parts[0]) {
        const [type, period, amount, frequency] = parts;
        const expenseData = {
          type: type.trim(),
          period: period.trim() || '',
          amount: parseFloat(amount) || 0,
          frequency: frequency ? frequency.trim() : ''
        };
        if (!(await expenseExists(expenseData))) {
          await addExpense(expenseData);
          imported++;
        } else {
          skipped++;
        }
      }
    }
    const msg = `יובאו ${imported} הוצאות ✓${skipped > 0 ? ` (${skipped} כפילויות התעלמו)` : ''}`;
    if (statusEl) statusEl.textContent = msg;
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

// Solar roof income
document.getElementById('save-solar')?.addEventListener('click', async () => {
  const editId = solarView?.dataset?.editId;
  const period = document.getElementById('solar-period').value.trim();
  const amount = parseFloat(document.getElementById('solar-amount').value) || 0;
  if (!period) { alert('הזן תקופה'); return; }
  if (amount <= 0) { alert('הזן סכום תקין'); return; }
  const entry = { period, amount };
  if (await solarIncomeExists(entry, editId ? Number(editId) : null)) {
    alert('הכנסה כזו כבר קיימת');
    return;
  }
  if (editId) {
    await updateSolarIncome(Number(editId), entry);
    delete solarView?.dataset?.editId;
  } else {
    await addSolarIncome(entry);
  }
  document.getElementById('solar-period').value = '';
  document.getElementById('solar-amount').value = '';
  await renderSolarIncome();
});

document.getElementById('solar-list')?.addEventListener('click', async e => {
  const editBtn = e.target.closest('.btn-edit-solar');
  const delBtn = e.target.closest('.btn-delete-solar');
  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    const items = await getAllSolarIncome();
    const item = items.find(i => i.id === id);
    if (!item) return;
    document.getElementById('solar-period').value = item.period || '';
    document.getElementById('solar-amount').value = Number(item.amount || 0);
    solarView.dataset.editId = id;
    return;
  }
  if (!delBtn) return;
  const id = Number(delBtn.dataset.id);
  if (await confirmDialog('מחק את ההכנסה?')) {
    await deleteSolarIncome(id);
    await renderSolarIncome();
  }
});

document.getElementById('solar-export-csv')?.addEventListener('click', async () => {
  const items = await getAllSolarIncome();
  const csv = 'Period,Amount\n' + items.map(i => `${i.period || ''},${i.amount || 0}`).join('\n');
  await downloadCsv(csv, 'solar_income.csv');
});

document.getElementById('solar-import-csv')?.addEventListener('click', async () => {
  const file = document.getElementById('solar-csv-upload').files[0];
  if (!file) { alert('בחר קובץ'); return; }
  const statusEl = document.getElementById('solar-csv-status');
  if (statusEl) statusEl.textContent = 'מעבד...';
  try {
    const text = await readCsvWithEncoding(file);
    const lines = text.trim().split('\n');
    let imported = 0;
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 2 && parts[0]) {
        const [period, amount] = parts;
        const entry = {
          period: period.trim(),
          amount: parseFloat(amount) || 0
        };
        if (!(await solarIncomeExists(entry))) {
          await addSolarIncome(entry);
          imported++;
        } else {
          skipped++;
        }
      }
    }
    const msg = `יובאו ${imported} רשומות ✓${skipped > 0 ? ` (${skipped} כפילויות התעלמו)` : ''}`;
    if (statusEl) statusEl.textContent = msg;
  } catch (err) {
    if (statusEl) statusEl.textContent = `שגיאה: ${err.message}`;
  }
  await renderSolarIncome();
});

document.getElementById('solar-clear-all')?.addEventListener('click', async () => {
  if (await confirmDialog('מחק את כל ההכנסות?')) {
    await clearAllSolarIncome();
    await renderSolarIncome();
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
  const tenant = tenantId
    ? (isRemoteApp() ? await getTenantByIdRemote(tenantId) : await getTenantById(tenantId))
    : null;
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
      payload.tenantId = existing?.tenantId ?? payload.tenantId;
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
    const unmatchedText = res.unmatched ? `, ${res.unmatched} ללא התאמה` : '';
    if (statusEl) statusEl.textContent = `יובאו ${res.success}/${res.total} תשלומים (${res.skipped} כפילויות דולגו${unmatchedText}) ✓`;
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
const syncAllBtn = document.getElementById('sync-all-data');
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

syncAllBtn?.addEventListener('click', async () => {
  await syncAllLocalDataToServer();
  await renderTenants();
  await renderArchive();
  await renderReadings();
  await renderPayments();
  await renderExpenses();
  await renderSolarIncome();
  await renderBalance();
  await renderMom();
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
    const unmatchedText = res.unmatched ? `, ${res.unmatched} ללא התאמה` : '';
    if (statusEl) statusEl.textContent = `יובאו ${res.success}/${res.total} קריאות (${res.skipped} כפילויות דולגו${unmatchedText}) ✓`;
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

document.getElementById('bills-report')?.addEventListener('click', async e => {
  const btn = e.target.closest('.btn-pdf');
  const waBtn = e.target.closest('.btn-whatsapp-pdf');
  if ((!btn && !waBtn) || !lastMonthlyReport) return;

  const selectedBtn = btn || waBtn;
  const rowIndex = Number(selectedBtn.dataset.rowIndex);
  const apartment = selectedBtn.dataset.tenant;
  const row = Number.isFinite(rowIndex) && rowIndex >= 0
    ? lastMonthlyReport.rows[rowIndex]
    : lastMonthlyReport.rows.find(r => String(r.apartment) === String(apartment));
  if (!row) { alert('לא נמצא דייר'); return; }

  if (btn) {
    const html = buildTenantPdfHtml(row, lastMonthlyReport.monthValue);
    openPdfWindow(html);
    return;
  }

  if (waBtn) {
    await shareTenantReportToWhatsApp(row, lastMonthlyReport.monthValue);
  }
});

let readingEditCurrentId = null;
let readingEditTenants = [];

function closeReadingEditModal() {
  const modal = document.getElementById('reading-edit-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
  readingEditCurrentId = null;
}

async function getReadingByIdLocal(id) {
  return await new Promise((res, rej) => {
    getTx('readings', 'readonly').then(tx => {
      const req = tx.objectStore('readings').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    }).catch(rej);
  });
}

function sortTenantsForReadingModal(tenants) {
  return tenants.slice().sort((a, b) => {
    const aAptRaw = String(a.apartmentNumber || '').trim();
    const bAptRaw = String(b.apartmentNumber || '').trim();
    const aAptNum = Number(aAptRaw);
    const bAptNum = Number(bAptRaw);
    const aIsNum = !Number.isNaN(aAptNum);
    const bIsNum = !Number.isNaN(bAptNum);
    if (aIsNum && bIsNum && aAptNum !== bAptNum) return aAptNum - bAptNum;
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;
    const aName = `${a.firstName || ''} ${a.lastName || ''}`.trim();
    const bName = `${b.firstName || ''} ${b.lastName || ''}`.trim();
    return aName.localeCompare(bName, 'he');
  });
}

async function fillReadingEditTenantOptions(selectedTenantId = null) {
  const select = document.getElementById('reading-edit-tenant');
  if (!select) return;

  readingEditTenants = isRemoteApp()
    ? await getAllTenantsRemote(true)
    : await getAllTenants(true);
  const sorted = sortTenantsForReadingModal(readingEditTenants);

  select.innerHTML = '<option value="">ללא דייר</option>';
  sorted.forEach(t => {
    const option = document.createElement('option');
    const fullName = `${t.firstName || ''} ${t.lastName || ''}`.trim() || '-';
    const status = t.archived ? ' (לא פעיל)' : ' (פעיל)';
    option.value = String(t.id);
    option.textContent = `${t.apartmentNumber || '-'}: ${fullName}${status}`;
    select.appendChild(option);
  });

  if (selectedTenantId) {
    select.value = String(selectedTenantId);
  }
}

async function openReadingEditModal(readingId) {
  const rec = isRemoteApp()
    ? await getReadingByIdRemote(readingId)
    : await getReadingByIdLocal(readingId);
  if (!rec) {
    alert('לא נמצא רישום');
    return;
  }

  readingEditCurrentId = Number(readingId);
  await fillReadingEditTenantOptions(rec.tenantId || null);

  document.getElementById('reading-edit-apartment').value = String(rec.apartmentNumber || '').trim();
  document.getElementById('reading-edit-date').value = formatDateEu(rec.date || '');
  document.getElementById('reading-edit-meter-type').value = rec.meterType === 'water' ? 'water' : 'electricity';
  document.getElementById('reading-edit-value').value = String(rec.value ?? '');
  document.getElementById('reading-edit-notes').value = rec.notes || '';
  document.getElementById('reading-edit-paid').checked = !!rec.paid;

  const statusRow = document.getElementById('reading-edit-status-row');
  const statusSelect = document.getElementById('reading-edit-status');
  if (statusRow && statusSelect) {
    if (isRemoteApp()) {
      statusRow.style.display = '';
      const recStatus = String(rec.status || 'approved').toLowerCase();
      statusSelect.value = ['approved', 'pending', 'rejected'].includes(recStatus) ? recStatus : 'approved';
    } else {
      statusRow.style.display = 'none';
      statusSelect.value = 'approved';
    }
  }

  const modal = document.getElementById('reading-edit-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

document.getElementById('reading-edit-tenant')?.addEventListener('change', e => {
  const tenantId = Number(e.target.value || 0);
  if (!tenantId) return;
  const tenant = readingEditTenants.find(t => Number(t.id) === tenantId);
  if (!tenant) return;
  document.getElementById('reading-edit-apartment').value = String(tenant.apartmentNumber || '').trim();
});

document.getElementById('reading-edit-cancel')?.addEventListener('click', () => {
  closeReadingEditModal();
});

document.getElementById('reading-edit-save')?.addEventListener('click', async () => {
  if (!readingEditCurrentId) return;

  const dateRaw = document.getElementById('reading-edit-date').value.trim();
  const parsedDate = parseDateToIso(dateRaw);
  if (!parsedDate) {
    alert('תאריך לא תקין');
    return;
  }

  const valueRaw = document.getElementById('reading-edit-value').value;
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) {
    alert('ערך קריאה לא תקין');
    return;
  }

  const selectedTenantId = Number(document.getElementById('reading-edit-tenant').value || 0);
  const selectedTenant = selectedTenantId
    ? readingEditTenants.find(t => Number(t.id) === selectedTenantId) || null
    : null;

  const patch = {
    tenantId: selectedTenant ? Number(selectedTenant.id) : null,
    tenantName: selectedTenant ? `${selectedTenant.firstName || ''} ${selectedTenant.lastName || ''}`.trim() : '',
    apartmentNumber: document.getElementById('reading-edit-apartment').value.trim(),
    meterType: document.getElementById('reading-edit-meter-type').value,
    value,
    date: parsedDate,
    notes: document.getElementById('reading-edit-notes').value.trim(),
    paid: document.getElementById('reading-edit-paid').checked
  };

  if (isRemoteApp()) {
    const nextStatus = String(document.getElementById('reading-edit-status').value || 'approved').toLowerCase();
    patch.status = ['approved', 'pending', 'rejected'].includes(nextStatus) ? nextStatus : 'approved';
  }

  try {
    await updateReading(readingEditCurrentId, patch);
    closeReadingEditModal();
    await renderReadings();
    alert('קריאה עודכנה');
  } catch (err) {
    console.error(err);
    alert('שגיאה בעדכון: ' + err.message);
  }
});

// Reading edit/delete handlers (delegated)
document.getElementById('readings-list')?.addEventListener('click', async e => {
  const header = e.target.closest('th[data-key]');
  if (header) {
    const key = header.dataset.key;
    if (readingsSort.key === key) {
      readingsSort.dir = readingsSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      readingsSort.key = key;
      readingsSort.dir = 'asc';
    }
    await renderReadings();
    return;
  }
  const editBtn = e.target.closest('.btn-edit-reading');
  const delBtn = e.target.closest('.btn-delete-reading');
  const row = e.target.closest('.reading-row');
  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    try {
      await openReadingEditModal(id);
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
  if (row) {
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
    document.querySelectorAll('.reading-row.selected').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    const id = Number(row.dataset.readingId);
    const detailRow = document.querySelector(`.reading-detail-row[data-reading-id="${id}"]`);
    if (!detailRow) return;
    const cell = detailRow.querySelector('td');
    if (!cell) return;
    const cache = window.__readingsDetailCache || {};
    const prev = cache.prevById ? cache.prevById.get(id) : null;
    const reading = cache.readingById ? cache.readingById.get(id) : null;
    const waterPrice = Number(cache.waterPrice || 0);
    const kvaCon = Number(cache.kvaCon || 0);

    if (!reading) return;

    const meterLabel = meterTypeLabel(reading.meterType);
    const currentValue = Number(reading.value || 0);
    const prevValue = prev ? Number(prev.value || 0) : null;
    const prevDate = prev ? formatDateEu(prev.date) : '';
    const currentDateValue = dateValueFromAny(reading.date);
    const prevDateValue = prev ? dateValueFromAny(prev.date) : Number.NaN;
    const daysBetween = prev && !Number.isNaN(currentDateValue) && !Number.isNaN(prevDateValue)
      ? Math.round((currentDateValue - prevDateValue) / (1000 * 60 * 60 * 24))
      : null;

    let consumption = null;
    let amount = null;
    if (prev) {
      consumption = currentValue - Number(prev.value || 0);
      if (meterLabel === 'חשמל') {
        amount = (kvaCon / 4) + (Math.max(0, consumption) * 0.65);
      } else if (meterLabel === 'מים') {
        amount = Math.max(0, consumption) * waterPrice;
      }
    }

    if (!prev) {
      cell.innerHTML = `<div style="color:#666;">אין קריאה קודמת לחישוב.</div>`;
    } else {
      cell.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(6, 1fr); gap: 12px; align-items: center;">
          <div><strong>קריאה קודמת:</strong><br>${prevValue}</div>
          <div><strong>תאריך קודם:</strong><br>${prevDate || '-'}</div>
          <div><strong>קריאה נוכחית:</strong><br>${currentValue}</div>
          <div><strong>ימים בין קריאות:</strong><br>${daysBetween ?? '-'}</div>
          <div><strong>צריכה:</strong><br>${Number(consumption || 0).toFixed(2)}</div>
          <div><strong>חיוב:</strong><br>₪${formatCurrency(amount || 0)}</div>
        </div>
      `;
    }
    detailRow.classList.toggle('hidden');
  }
});

document.getElementById('readings-list')?.addEventListener('change', async e => {
  const paidToggle = e.target.closest('.reading-paid-toggle');
  if (paidToggle) {
    const readingId = Number(paidToggle.dataset.readingId);
    await updateReading(readingId, { paid: paidToggle.checked });
    await renderReadings();
    return;
  }
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
    ['date', 'apartment', 'tenant', 'meter_type', 'meter_number', 'value', 'paid']
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
      r.value ?? '',
      r.paid ? '1' : '0'
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
  const tenants = isRemoteApp() ? await getAllTenantsRemote(true) : await getAllTenants(true);
  const tenantIndex = buildTenantNameIndex(tenants);
  const tenantPartsIndex = buildTenantNamePartsIndex(tenants);

  let total = 0, success = 0, skipped = 0, unmatched = 0;
  const unmatchedNames = new Set();

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const date = row[0]?.trim();
    const apartment = row[1]?.trim();
    const tenantName = row[2]?.trim();
    const meterType = meterTypeFromCsv(row[3]);
    const meterNumber = row[4]?.trim();
    const value = Number(String(row[5] || '').replace(/,/g, ''));
    const paid = parsePaidCsvValue(row[6]);

    if (!date || !apartment || !meterType || Number.isNaN(value)) continue;
    total++;
    let tenant = findTenantByName(tenantIndex, tenantName);
    if (!tenant && tenantName) {
      const nameParts = splitName(tenantName);
      tenant = findTenantByNameParts(tenantPartsIndex, nameParts.firstName, nameParts.lastName);
    }
    if (!tenant && tenantName) {
      tenant = findTenantByNameMatch(tenants, tenantName);
    }
    if (!tenant) {
      unmatched++;
      if (tenantName) unmatchedNames.add(tenantName);
      continue;
    }
    const key = `${tenant?.id || ''}|${meterType}|${date}`;
    if (existingSet.has(key)) { skipped++; continue; }

    const readingPayload = {
      tenantId: tenant?.id || null,
      meterType,
      value,
      date,
      paid,
      tenantName: tenant ? `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim() : (tenantName || ''),
      apartmentNumber: tenant?.apartmentNumber || apartment || ''
    };
    await addReading(readingPayload);
    existingSet.add(key);
    success++;
  }

  if (unmatchedNames.size > 0) {
    console.warn('Unmatched tenant names in readings import:', Array.from(unmatchedNames));
  }

  return { success, total, skipped, unmatched };
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

  let total = 0, success = 0, skipped = 0, unmatched = 0;
  const unmatchedNames = new Set();

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
    let tenant = findTenantByName(tenantIndex, tenantName);
    if (!tenant && tenantName) {
      tenant = findTenantByNameParts(tenantPartsIndex, firstName, lastName);
    }
    if (!tenant && tenantName) {
      tenant = findTenantByNameMatch(tenants, tenantName);
    }
    if (!tenant) {
      unmatched++;
      if (tenantName) unmatchedNames.add(tenantName);
      continue;
    }
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
  if (unmatchedNames.size > 0) {
    console.warn('Unmatched tenant names in payments import:', Array.from(unmatchedNames));
  }

  return { success, total, skipped, unmatched };
}

// Payments edit/delete handlers
document.getElementById('payments-list')?.addEventListener('click', async e => {
  const editBtn = e.target.closest('.btn-edit-payment');
  const delBtn = e.target.closest('.btn-delete-payment');
  if (editBtn) {
    const id = Number(editBtn.dataset.id);
    try {
      const allPayments = await getAllPayments();
      const rec = allPayments.find(p => p.id === id);
      if (!rec) return alert('לא נמצא רישום');

      await populateTenantSelects(true, 'payment', rec.tenantId || null);
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
    // Render current month summary (solar + balance)
    await renderCurrentMonthSummary();
    
    // Render income summary
    await renderIncomeSummary();
    
    // Render timeline
    await renderTimeline();
  } catch (err) {
    console.error('Dashboard render error:', err);
    const currentMonthSummary = document.getElementById('current-month-summary');
    const incomeSummary = document.getElementById('income-summary');
    const timelineContainer = document.getElementById('timeline-container');
    if (currentMonthSummary) currentMonthSummary.innerHTML = `<p style="color: red;">שגיאה: ${err.message}</p>`;
    if (incomeSummary) incomeSummary.innerHTML = `<p style="color: red;">שגיאה: ${err.message}</p>`;
    if (timelineContainer) timelineContainer.innerHTML = `<p style="color: red;">שגיאה: ${err.message}</p>`;
  }
}

async function renderCurrentMonthSummary() {
  const container = document.getElementById('current-month-summary');
  if (!container) return;

  try {
    // Get current month and year
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    const currentMonthKey = `${currentYear}-${currentMonth}`;

    // Get solar income
    const solarIncome = await getAllSolarIncome();
    const totalSolar = solarIncome.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    // Get cumulative balance from parent payments for current month
    // This is the balance from the "Mom" payment table
    const payments = await getAllPayments();
    const parentDefaultRaw = await getSetting('parentPaymentDefault');
    const parentPeriodsText = await getSetting('parentPaymentPeriods');
    const parentExempt = await getSetting('parentPaymentExemptMonths');
    const parentReductionsRaw = await getSetting('parentPaymentReductions');
    
    const parentDefault = Number(parentDefaultRaw ?? 4400) || 0;
    const parentPeriods = parseParentPaymentPeriods(parentPeriodsText || '');
    const parentExemptSet = new Set(Array.isArray(parentExempt) ? parentExempt : []);
    const parentReductions = parentReductionsRaw || {};
    
    const parentPaymentsByMonth = new Map();
    payments
      .filter(p => accountValueFromCsv(p.account) === 'grandma')
      .forEach(p => {
        const iso = parseDateToIso(p.date);
        if (!iso) return;
        const key = iso.slice(0, 7);
        parentPaymentsByMonth.set(key, (parentPaymentsByMonth.get(key) || 0) + Number(p.amount || 0));
      });

    // Calculate cumulative balance up to current month
    let currentMonthBalance = 0;
    const allMonths = [];
    
    parentPeriods.forEach(p => {
      p.months.forEach(m => {
        allMonths.push(`${p.year}-${String(m).padStart(2, '0')}`);
      });
    });
    parentPaymentsByMonth.forEach((_, key) => allMonths.push(key));
    parentExemptSet.forEach(key => allMonths.push(key));
    
    if (allMonths.length > 0) {
      allMonths.sort();
      const firstMonth = allMonths[0];
      
      const parentMonthSet = new Set();
      let [iterYear, iterMonth] = firstMonth.split('-').map(Number);
      const [currYear, currMonth] = currentMonthKey.split('-').map(Number);
      
      while (iterYear < currYear || (iterYear === currYear && iterMonth <= currMonth)) {
        parentMonthSet.add(`${iterYear}-${String(iterMonth).padStart(2, '0')}`);
        iterMonth++;
        if (iterMonth > 12) {
          iterMonth = 1;
          iterYear++;
        }
      }
      
      const parentMonths = Array.from(parentMonthSet).sort();
      let cumulativeBalance = 0;
      
      parentMonths.forEach(key => {
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
        
        const finalObligation = obligation - reductionAmount;
        const paid = parentPaymentsByMonth.get(key) || 0;
        const balance = paid - finalObligation;
        cumulativeBalance += balance;
      });
      
      currentMonthBalance = cumulativeBalance;
    }

    const balanceColor = currentMonthBalance >= 0 ? '#27ae60' : '#e74c3c';
    const monthDisplay = `${currentMonth}/${currentYear}`;

    container.innerHTML = `
      <div class="income-card">
        <h4>הכנסות גג סולארי</h4>
        <div class="amount" style="color: #f39c12; direction: ltr; text-align: left;">₪${formatCurrency(totalSolar)}</div>
      </div>
      <div class="income-card">
        <h4>עודף דוח חודש ${monthDisplay}</h4>
        <div class="amount" style="color: ${balanceColor}; direction: ltr; text-align: left;">₪${formatCurrency(currentMonthBalance)}</div>
      </div>
    `;
  } catch (err) {
    console.error('Current month summary error:', err);
    container.innerHTML = `<p style="color: red;">שגיאה: ${err.message}</p>`;
  }
}

async function exportTimelineCSV() {
  const tenants = await getAllTenants(true);
  const payments = await getAllPayments();

  if (tenants.length === 0) {
    alert('אין דיירים לייצוא');
    return;
  }

  const paymentRanges = new Map();
  payments.forEach(p => {
    if (!p.tenantId) return;
    const iso = parseDateToIso(p.date);
    if (!iso) return;
    if (!paymentRanges.has(p.tenantId)) {
      paymentRanges.set(p.tenantId, { min: iso, max: iso });
      return;
    }
    const range = paymentRanges.get(p.tenantId);
    if (iso < range.min) range.min = iso;
    if (iso > range.max) range.max = iso;
  });

  const tenantColumns = tenants
    .map(t => {
      const name = `${t.firstName || ''} ${t.lastName || ''}`.trim() || '-';
      const range = paymentRanges.get(t.id);
      const startIso = parseDateToIso(t.startDate) || range?.min || '';
      const endIso = parseDateToIso(t.moveOutDate || t.endDate) || range?.max || '';
      return {
        id: t.id,
        name,
        apt: t.apartmentNumber || 'ללא מספר',
        startIso,
        endIso
      };
    })
    .filter(t => !!t.startIso);

  if (tenantColumns.length === 0) {
    alert('אין דיירים עם תאריך התחלה');
    return;
  }

  tenantColumns.sort((a, b) => {
    const aNum = Number(a.apt);
    const bNum = Number(b.apt);
    if (Number.isNaN(aNum) && Number.isNaN(bNum)) return a.apt.localeCompare(b.apt);
    if (Number.isNaN(aNum)) return 1;
    if (Number.isNaN(bNum)) return -1;
    if (aNum !== bNum) return aNum - bNum;
    return a.startIso.localeCompare(b.startIso);
  });

  const monthIndex = iso => {
    const d = parseDate(iso);
    if (!d) return null;
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };

  let minIndex = null;
  let maxIndex = null;
  const todayIso = new Date().toISOString().slice(0, 10);

  tenantColumns.forEach(t => {
    const startIdx = monthIndex(t.startIso);
    const endIdx = monthIndex(t.endIso || todayIso);
    if (startIdx === null || endIdx === null) return;
    minIndex = minIndex === null ? startIdx : Math.min(minIndex, startIdx);
    maxIndex = maxIndex === null ? endIdx : Math.max(maxIndex, endIdx);
  });

  if (minIndex === null || maxIndex === null) {
    alert('לא ניתן לחשב טווח חודשי');
    return;
  }

  const paymentMap = new Map();
  payments.forEach(p => {
    if (!p.tenantId) return;
    const iso = parseDateToIso(p.date);
    if (!iso) return;
    const key = `${p.tenantId}|${iso.slice(0, 7)}`;
    if (!paymentMap.has(key)) paymentMap.set(key, { total: 0, byAccount: new Map() });
    const rec = paymentMap.get(key);
    const amount = Number(p.amount || 0);
    rec.total += amount;
    const acct = p.account || '';
    rec.byAccount.set(acct, (rec.byAccount.get(acct) || 0) + amount);
  });

  const rows = [];
  rows.push(['חודש', ...tenantColumns.map(t => `דירה ${t.apt}`)]);
  rows.push(['', ...tenantColumns.map(t => t.name)]);

  for (let idx = minIndex; idx <= maxIndex; idx += 1) {
    const year = Math.floor(idx / 12);
    const month = String((idx % 12) + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`;
    const monthLabel = `${month}/${year}`;

    const row = [monthLabel];

    tenantColumns.forEach(t => {
      const startIdx = monthIndex(t.startIso);
      const endIdx = monthIndex(t.endIso || todayIso);
      const isActive = startIdx !== null && endIdx !== null && idx >= startIdx && idx <= endIdx;

      const payKey = `${t.id}|${monthKey}`;
      const payment = paymentMap.get(payKey);
      const parts = [];
      const accountCode = acct => {
        if (acct === 'my') return 'N';
        if (acct === 'grandma') return 'E';
        const raw = String(acct || '').trim();
        return raw ? raw[0].toUpperCase() : 'A';
      };

      if (payment && payment.total) {
        const acctParts = [];
        payment.byAccount.forEach((amt, acct) => {
          if (!amt) return;
          acctParts.push(`${accountCode(acct)}-${formatCurrency(amt)}`);
        });
        if (acctParts.length) parts.push(acctParts.join(','));
      } else if (isActive) {
        parts.push('R');
      }

      row.push(parts.join(' '));
    });

    rows.push(row);
  }

  const csv = rows.map(row =>
    row.map(cell => {
      const cellStr = String(cell || '');
      return '"' + cellStr.replace(/"/g, '""') + '"';
    }).join(',')
  ).join('\n');

  downloadCsv(csv, `timeline_matrix_${new Date().toISOString().slice(0, 10)}.csv`);
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
  const expenses = await getAllExpenses();
  const container = document.getElementById('income-summary');
  if (!container) return;

  const myIncome = payments
    .filter(p => accountValueFromCsv(p.account) === 'my')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const grandmaIncome = payments
    .filter(p => accountValueFromCsv(p.account) === 'grandma')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalExpense = expenses.reduce((sum, ex) => sum + Number(ex.amount || 0), 0);
  const myNet = myIncome - totalExpense;
  const grandmaNet = grandmaIncome;
  const myNetColor = myNet >= 0 ? '#27ae60' : '#e74c3c';
  const grandmaNetColor = grandmaNet >= 0 ? '#27ae60' : '#e74c3c';

  if (payments.length === 0 && expenses.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; grid-column: 1/-1;">אין תשלומים עדיין</p>';
    return;
  }

  container.innerHTML = `
    <div class="income-card">
      <h4>נטו ניר וליאור</h4>
      <div class="amount" style="color: ${myNetColor}; direction: ltr; text-align: left;">₪${formatCurrency(myNet)}</div>
    </div>
    <div class="income-card">
      <h4>נטו אסתר ומיכאל</h4>
      <div class="amount" style="color: ${grandmaNetColor}; direction: ltr; text-align: left;">₪${formatCurrency(grandmaNet)}</div>
    </div>
  `;
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
  setActiveButton('show-dashboard');
  await renderDashboard();
  show(document.getElementById('dashboard-view'));
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

// Parent payments (Exempt & Reduction) - Export/Import/Clear
async function clearAllParentPaymentsData() {
  await setSetting('parentPaymentExemptMonths', []);
  await setSetting('parentPaymentReductions', {});
  await renderBalance();
  await renderMom();
}

// Init
window.addEventListener('DOMContentLoaded', async () => { 
  const authActionBtn = document.getElementById('auth-action-btn');
  if (authActionBtn) {
    authActionBtn.addEventListener('click', async () => {
      if (currentUser) {
        setAuthToken('');
        currentUser = null;
        window.location.reload();
        return;
      }
      await ensureServerAuth();
    });
  }

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

  if (isRemoteApp()) {
    await ensureRemoteAuth();
    updateAuthUI();
  } else {
    updateAuthUI();
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
