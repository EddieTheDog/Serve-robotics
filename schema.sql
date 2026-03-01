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

-- Run these in your D1 Console to add the new features

-- Add seat and badge columns to guests
ALTER TABLE guests ADD COLUMN seat TEXT;
ALTER TABLE guests ADD COLUMN badge TEXT;

-- Custom buttons shown in the attendee PWA (admin configures these)
CREATE TABLE IF NOT EXISTS custom_buttons (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  emoji TEXT DEFAULT '🔘',
  action TEXT DEFAULT 'none',   -- 'none' = display only, future: 'link', etc.
  sort_order INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Help reason options (admin configures these)
CREATE TABLE IF NOT EXISTS help_reasons (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  emoji TEXT DEFAULT '🙋',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Seed default help reasons
INSERT INTO help_reasons (id, label, emoji, sort_order, created_at) VALUES
  ('hr-1', 'I need assistance', '🙋', 0, unixepoch() * 1000),
  ('hr-2', 'I have a question', '❓', 1, unixepoch() * 1000),
  ('hr-3', 'Technical issue', '⚙️', 2, unixepoch() * 1000),
  ('hr-4', 'Medical concern', '🏥', 3, unixepoch() * 1000);

-- Global refresh signal (bump updated_at to tell all PWAs to reload)
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES ('refresh_signal', '0', unixepoch() * 1000);
INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES ('event_location', 'Main Hall', unixepoch() * 1000);
