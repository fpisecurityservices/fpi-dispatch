// api/entries/[id].js
// GET   /api/entries/:id   fetch one entry
// PATCH /api/entries/:id   correct a field (rare)

import { sql } from '@vercel/postgres';
import { toEntry } from '../../lib/_db.js';

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM entries WHERE id = ${id}`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(toEntry(rows[0]));
  }

  if (req.method === 'PATCH') {
    const { notes, category, priority } = req.body;
    const { rows } = await sql`
      UPDATE entries SET
        notes    = COALESCE(${notes    ?? null}, notes),
        category = COALESCE(${category ?? null}, category),
        priority = COALESCE(${priority ?? null}, priority)
      WHERE id = ${id}
      RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(toEntry(rows[0]));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
