const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT id, name, created_at FROM dispatchers WHERE active = true ORDER BY name`;
      return res.status(200).json(rows);
    }
    if (req.method === 'POST') {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
      const { rows } = await sql`
        INSERT INTO dispatchers (name) VALUES (${name.trim()})
        ON CONFLICT (name) DO UPDATE SET active = true
        RETURNING id, name
      `;
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Name required' });
      await sql`UPDATE dispatchers SET active = false WHERE name = ${name}`;
      return res.status(200).json({ ok: true });
    }
    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
