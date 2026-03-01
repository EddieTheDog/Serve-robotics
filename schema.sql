-- Existing table (keep as-is, add app_token + locked columns)
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  qr_data TEXT,
  status TEXT NOT NULL,
  app_token TEXT UNIQUE,         -- unique token for /app?token=xxx
  locked INTEGER DEFAULT 0,      -- 1 = locked out of PWA
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Schedule items shown in the attendee PWA
CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_live INTEGER DEFAULT 0,     -- 1 = currently highlighted as "happening now"
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Help requests from the attendee PWA → alerts admin dashboard
CREATE TABLE IF NOT EXISTS help_requests (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL,
  message TEXT,
  resolved INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (guest_id) REFERENCES guests(id)
);
