// api/dispatchers.js
// GET  /api/dispatchers   list all dispatchers
// POST /api/dispatchers   add a dispatcher

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { rows } = await sql`SELECT name FROM dispatchers ORDER BY name ASC`;
    return res.status(200).json(rows.map(r => r.name));
  }

  if (req.method === 'POST') {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    await sql`
      INSERT INTO dispatchers (name)
      VALUES (${name.trim()})
      ON CONFLICT (name) DO NOTHING
    `;
    return res.status(201).json({ name: name.trim() });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
