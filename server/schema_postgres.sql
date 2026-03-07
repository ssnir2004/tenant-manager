CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  "firstName" TEXT,
  "lastName" TEXT,
  "nationalId" TEXT,
  phone TEXT,
  "startDate" TEXT,
  "endDate" TEXT,
  "moveOutDate" TEXT,
  "rentAmount" DOUBLE PRECISION,
  "rentHistory" TEXT,
  "arnonaAmount" DOUBLE PRECISION,
  "depositDay" TEXT,
  "apartmentNumber" TEXT,
  "electricityMeter" TEXT,
  "waterMeter" TEXT,
  notes TEXT,
  "createdAt" TEXT,
  archived INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS readings (
  id SERIAL PRIMARY KEY,
  "tenantId" INTEGER,
  "meterType" TEXT,
  date TEXT,
  value DOUBLE PRECISION,
  paid INTEGER DEFAULT 0,
  notes TEXT,
  "createdAt" TEXT,
  status TEXT DEFAULT 'approved',
  "submittedByUserId" INTEGER,
  "approvedByUserId" INTEGER,
  "approvedAt" TEXT,
  FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  "passwordHash" TEXT NOT NULL,
  role TEXT NOT NULL,
  "canWrite" INTEGER DEFAULT 0,
  "canSubmitReadings" INTEGER DEFAULT 0,
  "isActive" INTEGER DEFAULT 1,
  "createdAt" TEXT
);

CREATE TABLE IF NOT EXISTS user_tenants (
  "userId" INTEGER NOT NULL,
  "tenantId" INTEGER NOT NULL,
  PRIMARY KEY ("userId", "tenantId"),
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bills (
  id SERIAL PRIMARY KEY,
  "tenantId" INTEGER,
  month TEXT,
  electricity DOUBLE PRECISION,
  water DOUBLE PRECISION,
  total DOUBLE PRECISION,
  "createdAt" TEXT,
  FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  "tenantId" INTEGER,
  amount DOUBLE PRECISION,
  method TEXT,
  account TEXT,
  date TEXT,
  notes TEXT,
  "createdAt" TEXT,
  FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  type TEXT,
  period TEXT,
  amount DOUBLE PRECISION,
  frequency TEXT,
  date TEXT,
  paid INTEGER DEFAULT 0,
  "createdAt" TEXT
);

CREATE TABLE IF NOT EXISTS solar (
  id SERIAL PRIMARY KEY,
  period TEXT,
  amount DOUBLE PRECISION,
  date TEXT,
  "createdAt" TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
