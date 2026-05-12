-- ============================================================================
-- FPI Dispatch Portal — Migration 002
-- Adds accounts table and links entries to accounts
-- Run in Neon SQL Editor at console.neon.tech
-- ============================================================================

BEGIN;

CREATE TABLE accounts (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  account_number TEXT,
  site           TEXT,
  client_contact TEXT,
  client_email   TEXT,
  client_phone   TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_name ON accounts(name);

-- Link entries to accounts (nullable — not all entries have an account)
ALTER TABLE entries ADD COLUMN IF NOT EXISTS account_id INT REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_entries_account_id ON entries(account_id);

COMMIT;
