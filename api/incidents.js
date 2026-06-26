// api/incidents.js
// GET /api/incidents   returns all non-resolved incidents with full thread

import { sql } from '@vercel/postgres';
import { toIncident, toThreadEvent } from '../lib/_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return active incidents sorted by priority weight then opened_at desc.
  // Incidents are created server-side via POST /api/entries — no POST here.
  const { rows: incRows } = await sql`
    SELECT i.*,
           e.account_id AS account_id,
           COALESCE(
             json_agg(t ORDER BY t.ts ASC) FILTER (WHERE t.id IS NOT NULL),
             '[]'::json
           ) AS thread_json
    FROM incidents i
    LEFT JOIN entries e ON e.id = i.entry_id
    LEFT JOIN incident_thread t ON t.incident_id = i.id
    WHERE i.status != 'resolved'
    GROUP BY i.id, e.account_id
    ORDER BY
      CASE i.priority
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        WHEN 'low'      THEN 4
      END,
      i.opened_at DESC
  `;

  const incidents = incRows.map(row => {
    const thread = (row.thread_json || []).map(toThreadEvent);
    return toIncident(row, thread);
  });

  return res.status(200).json(incidents);
}
