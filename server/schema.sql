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
  rentHistory TEXT,
  arnonaAmount REAL,
  arnonaHistory TEXT,
  depositDay TEXT,
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
  paid INTEGER DEFAULT 0,
  notes TEXT,
  createdAt TEXT,
  status TEXT DEFAULT 'approved',
  submittedByUserId INTEGER,
  approvedByUserId INTEGER,
  approvedAt TEXT,
  FOREIGN KEY (tenantId) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL,
  canWrite INTEGER DEFAULT 0,
  canSubmitReadings INTEGER DEFAULT 0,
  isActive INTEGER DEFAULT 1,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS user_tenants (
  userId INTEGER NOT NULL,
  tenantId INTEGER NOT NULL,
  PRIMARY KEY (userId, tenantId),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
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
  category TEXT,
  date TEXT,
  notes TEXT,
  readingId TEXT,
  createdAt TEXT,
  FOREIGN KEY (tenantId) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  period TEXT,
  amount REAL,
  frequency TEXT,
  date TEXT,
  paid INTEGER DEFAULT 0,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS solar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT,
  amount REAL,
  date TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
