const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT key, value FROM app_settings`;
      return res.status(200).json(Object.fromEntries(rows.map(r => [r.key, r.value])));
    }
    if (req.method === 'POST') {
      const updates = req.body;
      for (const [key, value] of Object.entries(updates)) {
        await sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${String(value)})
          ON CONFLICT (key) DO UPDATE SET value = ${String(value)}`;
      }
      return res.status(200).json({ ok: true });
    }
    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
