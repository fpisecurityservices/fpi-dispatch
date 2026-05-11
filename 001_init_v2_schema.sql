-- ============================================================================
-- FPI Dispatch Operations Portal v2 — Initial Schema
-- Migration: 001_init_v2_schema.sql
--
-- Strategy: Clean wipe of any v1 tables, then build v2 from scratch.
-- Run inside a transaction. Safe to re-run (uses IF EXISTS / DROP CASCADE).
--
-- Note on the README schema: it lists `entries.incident_id REFERENCES
-- incidents(id)` before `incidents` is created. That ordering fails. Here we
-- create entries first (no FK on incident_id), create incidents (which can
-- safely FK back to entries), then ALTER entries to add the FK.
-- ============================================================================

BEGIN;

-- ---- Wipe v1 (confirmed not needed) -----------------------------------------
-- Add any other v1 table names below if they exist in your DB.
DROP TABLE IF EXISTS incident_thread CASCADE;
DROP TABLE IF EXISTS incidents       CASCADE;
DROP TABLE IF EXISTS entries         CASCADE;
DROP TABLE IF EXISTS shifts          CASCADE;
DROP TABLE IF EXISTS dispatchers     CASCADE;
DROP TABLE IF EXISTS routing_rules   CASCADE;
DROP TABLE IF EXISTS contacts        CASCADE;

-- ---- Roster of dispatchers --------------------------------------------------
CREATE TABLE dispatchers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Shift markers: start / handoff / end -----------------------------------
CREATE TABLE shifts (
  id          SERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatcher  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('start','handoff','end')),
  note        TEXT
);

-- ---- Entries: unified log of phone calls, guard reports, system notes -------
-- incident_id FK added after incidents table is created (below).
CREATE TABLE entries (
  id           SERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  template     TEXT NOT NULL CHECK (template IN ('phone','guard','system')),
  caller_type  TEXT NOT NULL
               CHECK (caller_type IN ('public','client','guard','supervisor','system','dispatch')),
  fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  category     TEXT NOT NULL,
  priority     TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  notes        TEXT,
  dispatcher   TEXT NOT NULL,
  is_incident  BOOLEAN NOT NULL DEFAULT false,
  incident_id  INT
);

-- ---- Incidents: tracked entries with a thread of updates --------------------
CREATE TABLE incidents (
  id           SERIAL PRIMARY KEY,
  entry_id     INT REFERENCES entries(id) ON DELETE SET NULL,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by    TEXT NOT NULL,
  title        TEXT NOT NULL,
  site         TEXT,
  unit         TEXT,
  callback     TEXT,
  caller_name  TEXT,
  category     TEXT NOT NULL,
  priority     TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  caller_type  TEXT,
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new','ack','progress','callback','update','resolved')),
  resolved_at  TIMESTAMPTZ
);

-- Back-reference: entries.incident_id -> incidents.id
ALTER TABLE entries
  ADD CONSTRAINT entries_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL;

-- ---- Incident thread: timeline events per incident --------------------------
CREATE TABLE incident_thread (
  id           SERIAL PRIMARY KEY,
  incident_id  INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  who          TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('create','status','update','resolve','callback','handoff')),
  action       TEXT,
  body         TEXT
);

-- ---- Auto-routing rules -----------------------------------------------------
CREATE TABLE routing_rules (
  id            TEXT PRIMARY KEY,
  when_key      TEXT NOT NULL CHECK (when_key IN ('priority','category','callerType')),
  when_value    TEXT NOT NULL,
  to_recipients JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- ---- Notification contacts --------------------------------------------------
CREATE TABLE contacts (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  role   TEXT,
  email  TEXT,
  phone  TEXT
);

-- ---- Indexes ----------------------------------------------------------------
CREATE INDEX idx_entries_ts          ON entries(ts DESC);
CREATE INDEX idx_entries_incident_id ON entries(incident_id);
CREATE INDEX idx_entries_template    ON entries(template);
CREATE INDEX idx_incidents_status    ON incidents(status);
CREATE INDEX idx_incidents_priority  ON incidents(priority);
CREATE INDEX idx_incidents_opened_at ON incidents(opened_at DESC);
CREATE INDEX idx_thread_incident     ON incident_thread(incident_id, ts);
CREATE INDEX idx_shifts_ts           ON shifts(ts DESC);

-- ============================================================================
-- Seeds: defaults pulled from the prototype constants in dispatch.js.
-- Adjust before running in production if your roster / contacts differ.
-- ============================================================================

INSERT INTO dispatchers (name) VALUES
  ('Rosa M.'),
  ('Carlos D.'),
  ('Aisha P.'),
  ('James W.');

INSERT INTO contacts (name, role, email) VALUES
  ('Daniel R.',        'Ops Manager',          'daniel@fpisecurity.com'),
  ('Field Supervisor', 'Field Sup. (on duty)', 'field-sup@fpisecurity.com'),
  ('Scheduling Lead',  'Scheduling',           'scheduling@fpisecurity.com'),
  ('Account Manager',  'Client Accounts',      'accounts@fpisecurity.com');

INSERT INTO routing_rules (id, when_key, when_value, to_recipients) VALUES
  ('r1', 'priority',   'critical',          '["Daniel R. (Ops Mgr)","Field Supervisor","Account Manager"]'::jsonb),
  ('r2', 'priority',   'high',              '["Daniel R. (Ops Mgr)","Field Supervisor"]'::jsonb),
  ('r3', 'category',   'No Call / No Show', '["Scheduling Lead","Field Supervisor"]'::jsonb),
  ('r4', 'category',   'Post Abandoned',    '["Daniel R. (Ops Mgr)","Field Supervisor","Account Manager"]'::jsonb),
  ('r5', 'callerType', 'client',            '["Account Manager"]'::jsonb),
  ('r6', 'category',   'Client Inquiry',    '["Account Manager"]'::jsonb),
  ('r7', 'category',   'Medical',           '["Daniel R. (Ops Mgr)","Field Supervisor"]'::jsonb),
  ('r8', 'category',   'Scheduling',        '["Scheduling Lead"]'::jsonb);

COMMIT;

-- ============================================================================
-- Manual rollback:
--   DROP TABLE IF EXISTS incident_thread, incidents, entries, shifts,
--                        dispatchers, routing_rules, contacts CASCADE;
-- ============================================================================
