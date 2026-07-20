// api/bols.js
// GET  /api/bols   list all watch orders (newest first)
// POST /api/bols   create a watch order

import { sql } from '@vercel/postgres';
import { toBol } from '../lib/_db.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM bols ORDER BY created_at DESC, id DESC`;
    return res.status(200).json(rows.map(toBol));
  }

  if (req.method === 'POST') {
    const { text, by = 'Dispatch' } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    const { rows: [row] } = await sql`
      INSERT INTO bols (text, by_who)
      VALUES (${text.trim()}, ${(by || 'Dispatch').trim()})
      RETURNING *
    `;
    return res.status(201).json(toBol(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
