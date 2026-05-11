// api/shifts.js
// GET  /api/shifts   list shift markers (most recent first)
// POST /api/shifts   log a shift start / handoff / end

import { sql } from '@vercel/postgres';
import { toShift } from '../lib/_db.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT * FROM shifts ORDER BY ts DESC LIMIT 200
    `;
    return res.status(200).json(rows.map(toShift));
  }

  if (req.method === 'POST') {
    const { dispatcher, kind, note } = req.body;

    if (!dispatcher) return res.status(400).json({ error: 'dispatcher is required' });
    if (!['start','handoff','end'].includes(kind)) {
      return res.status(400).json({ error: `Invalid kind: ${kind}` });
    }

    const { rows: [row] } = await sql`
      INSERT INTO shifts (dispatcher, kind, note)
      VALUES (${dispatcher}, ${kind}, ${note || ''})
      RETURNING *
    `;
    return res.status(201).json(toShift(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
