const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { dispatcher_name, action, note } = req.body;
      if (!dispatcher_name || !action) return res.status(400).json({ error: 'dispatcher_name and action required' });
      await sql`INSERT INTO shift_log (dispatcher_name, action, note) VALUES (${dispatcher_name}, ${action}, ${note || ''})`;
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT * FROM shift_log ORDER BY ts DESC LIMIT 50`;
      return res.status(200).json(rows);
    }
    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
