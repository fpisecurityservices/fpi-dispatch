// api/guards/[id].js
// PATCH  /api/guards/:id   update status, days, or shifts
// DELETE /api/guards/:id   remove a guard

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
  const id = parseInt(req.query.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  if (req.method === 'PATCH') {
    const { status, days, shifts } = req.body;
    const { rows } = await sql`
      UPDATE guards
      SET
        status = COALESCE(${status ?? null}, status),
        days   = COALESCE(${days   ?? null}, days),
        shifts = COALESCE(${shifts ?? null}, shifts)
      WHERE id = ${id}
      RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    return res.status(200).json(toGuard(rows[0]));
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM guards WHERE id = ${id}`;
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
