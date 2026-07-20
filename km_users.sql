-- USERS TABLE — the API auto-creates & seeds this on startup.
-- Run manually only if you want to create it yourself in the Railway console.
CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'clerk' CHECK (role IN ('attorney','clerk')),
  pin_hash   TEXT NOT NULL,
  initials   TEXT,
  color      TEXT DEFAULT '#378ADD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pin ON users(pin_hash);
-- PINs are stored hashed (SHA-256 + pepper), never in plain text.
