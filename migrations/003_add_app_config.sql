-- Migration 003: app_config table for shared key-value settings
-- Stores webhook URL and other app-level config so it applies to all users
-- without requiring manual entry per session.

BEGIN;

CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Seed with the env-var value if it was already configured there;
-- otherwise starts empty and can be set via Settings → Webhook.
INSERT INTO app_config (key, value)
VALUES ('webhook_url', '')
ON CONFLICT (key) DO NOTHING;

COMMIT;
