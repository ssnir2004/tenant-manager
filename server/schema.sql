PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firstName TEXT,
  lastName TEXT,
  nationalId TEXT,
  phone TEXT,
  startDate TEXT,
  endDate TEXT,
  moveOutDate TEXT,
  rentAmount REAL,
  arnonaAmount REAL,
  apartmentNumber TEXT,
  electricityMeter TEXT,
  waterMeter TEXT,
  notes TEXT,
  createdAt TEXT,
  archived INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenantId INTEGER,
  meterType TEXT,
  date TEXT,
  value REAL,
  createdAt TEXT,
  FOREIGN KEY (tenantId) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenantId INTEGER,
  month TEXT,
  electricity REAL,
  water REAL,
  total REAL,
  createdAt TEXT,
  FOREIGN KEY (tenantId) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenantId INTEGER,
  amount REAL,
  method TEXT,
  account TEXT,
  date TEXT,
  notes TEXT,
  createdAt TEXT,
  FOREIGN KEY (tenantId) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
