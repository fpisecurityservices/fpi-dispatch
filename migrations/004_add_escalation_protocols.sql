-- ============================================================================
-- FPI Dispatch Portal — Migration 004
-- Adds escalation_protocols table so protocols are shared across all users
-- instead of living only in each browser's localStorage.
-- Run in Neon SQL Editor at console.neon.tech
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS escalation_protocols (
  id             SERIAL PRIMARY KEY,
  position       INT  NOT NULL DEFAULT 0,
  category       TEXT NOT NULL,
  trigger_level  TEXT NOT NULL DEFAULT 'medium'
                 CHECK (trigger_level IN ('critical','high','medium')),
  steps          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalation_protocols_position
  ON escalation_protocols(position);

-- ---- Seed with the defaults from dispatch.js (only if table is empty) -------
INSERT INTO escalation_protocols (position, category, trigger_level, steps)
SELECT * FROM (VALUES
  (0, 'Medical Emergency', 'critical', '[
    "Call 911 immediately — do not wait for officer assessment",
    "Notify Field Supervisor & Ops Manager simultaneously",
    "Dispatch nearest officer to scene if not already on-site",
    "Stay on line with caller until EMS arrives; document arrival time"
  ]'::jsonb),
  (1, 'Post Abandoned', 'critical', '[
    "Attempt radio & phone contact — document each attempt with timestamp",
    "If no contact within 5 min → notify Field Supervisor for immediate coverage",
    "Dispatch relief officer; notify Account Manager of potential service gap",
    "Ops Manager must be notified if gap exceeds 15 min"
  ]'::jsonb),
  (2, 'No Call / No Show', 'high', '[
    "Call officer personal number — 3 attempts over 10 min, leave voicemail",
    "Notify Field Supervisor for coverage decision",
    "Contact Scheduling Lead — relief assignment required",
    "Notify client contact if post will be uncovered more than 30 min"
  ]'::jsonb),
  (3, 'Trespassing / Disturbance', 'high', '[
    "Confirm officer is safe before any escalation",
    "If physical confrontation or weapons: advise officer to disengage, call 911",
    "Add suspect description as a BOL for all field units immediately",
    "Notify Account Manager if incident is on client property"
  ]'::jsonb),
  (4, 'Alarm Activation', 'medium', '[
    "Dispatch nearest officer; log estimated ETA",
    "Attempt to reach client key-holder contact",
    "If no key-holder response within 15 min and officer is on-scene, advise 911",
    "Log alarm company name, reference #, and clear incident when resolved"
  ]'::jsonb),
  (5, 'Suspicious Activity', 'medium', '[
    "Log full description as a BOL — share with all active field units",
    "Advise officer: observe and report only, no direct engagement unless necessary",
    "If behavior escalates to threat level, authorize officer to call 911",
    "Notify client if activity is on or adjacent to their property"
  ]'::jsonb)
) AS seed(position, category, trigger_level, steps)
WHERE NOT EXISTS (SELECT 1 FROM escalation_protocols);

COMMIT;

-- ============================================================================
-- Manual rollback:
--   DROP TABLE IF EXISTS escalation_protocols CASCADE;
-- ============================================================================
