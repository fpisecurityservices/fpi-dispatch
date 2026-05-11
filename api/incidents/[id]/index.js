// api/incidents/[id]/index.js
// PATCH /api/incidents/:id   update status or resolved_at standalone

import { sql } from '@vercel/postgres';
import { STATUS_KEYS } from '../../../lib/enums.js';
import { toIncident, toThreadEvent } from '../../../lib/_db.js';

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { status, resolved_at } = req.body;

  if (status && !STATUS_KEYS.includes(status)) {
    return res.status(400).json({ error: `Invalid status: ${status}` });
  }

  const resolvedAt = status === 'resolved'
    ? (resolved_at || new Date().toISOString())
    : (resolved_at ?? null);

  const { rows } = await sql`
    UPDATE incidents SET
      status      = COALESCE(${status     ?? null}, status),
      resolved_at = COALESCE(${resolvedAt ?? null}, resolved_at)
    WHERE id = ${id}
    RETURNING *
  `;

  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  // Return incident with thread
  const { rows: threadRows } = await sql`
    SELECT * FROM incident_thread WHERE incident_id = ${id} ORDER BY ts ASC
  `;

  return res.status(200).json(toIncident(rows[0], threadRows.map(toThreadEvent)));
}
