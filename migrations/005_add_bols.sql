-- ============================================================================
-- FPI Dispatch Portal — Migration 005
-- Adds bols table (watch orders / BOLs) so they are shared across all users
-- instead of living only in each browser's localStorage.
-- Run in Neon SQL Editor at console.neon.tech
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bols (
  id         SERIAL PRIMARY KEY,
  text       TEXT NOT NULL,
  by_who     TEXT NOT NULL DEFAULT 'Dispatch',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bols_created_at ON bols(created_at DESC);

COMMIT;

-- ============================================================================
-- Manual rollback:
--   DROP TABLE IF EXISTS bols CASCADE;
-- ============================================================================
