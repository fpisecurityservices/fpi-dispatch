const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    await sql`CREATE TABLE IF NOT EXISTS dispatchers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ DEFAULT NOW(),
      caller_type VARCHAR(20) NOT NULL,
      guard_name VARCHAR(100) DEFAULT '',
      unit_id VARCHAR(50) DEFAULT '',
      location VARCHAR(200) DEFAULT '',
      category VARCHAR(100) NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      notes TEXT DEFAULT '',
      status VARCHAR(20),
      is_incident BOOLEAN DEFAULT false,
      is_ncns BOOLEAN DEFAULT false,
      dispatcher_name VARCHAR(100) DEFAULT ''
    )`;
    await sql`CREATE TABLE IF NOT EXISTS shift_log (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ DEFAULT NOW(),
      dispatcher_name VARCHAR(100),
      action VARCHAR(20),
      note TEXT DEFAULT ''
    )`;
    await sql`CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT
    )`;
    await sql`INSERT INTO app_settings (key, value) VALUES
      ('alert_critical', 'true'),
      ('alert_high', 'true'),
      ('alert_followup', 'true'),
      ('alert_ncns', 'true'),
      ('alert_client', 'false'),
      ('alert_recipients', '')
      ON CONFLICT (key) DO NOTHING`;
    res.status(200).json({ ok: true, message: 'Database initialized successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
