// api/guards.js
// GET  /api/guards   list all guards
// POST /api/guards   create a guard

import { sql } from '@vercel/postgres';

function toGuard(row) {
  return {
    id:     row.id,
    name:   row.name,
    status: row.status,
    days:   row.days   || [],
    shifts: row.shifts || [],
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM guards ORDER BY created_at ASC`;
    return res.status(200).json(rows.map(toGuard));
  }

  if (req.method === 'POST') {
    const { name, status = 'available', days = [], shifts = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const { rows: [row] } = await sql`
      INSERT INTO guards (name, status, days, shifts)
      VALUES (${name.trim()}, ${status}, ${days}, ${shifts})
      RETURNING *
    `;
    return res.status(201).json(toGuard(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
