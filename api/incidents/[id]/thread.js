// api/incidents/[id]/thread.js
// POST /api/incidents/:id/thread
//   Appends a thread event, optionally changes status, and writes a
//   synthetic activity-log entry so the update appears in the log column.

import { db } from '@vercel/postgres';
import { STATUS_KEYS } from '../../../lib/enums.js';
import { toIncident, toThreadEvent, toEntry } from '../../../lib/_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const incidentId = req.query.id;
  const { who, kind, action, body: bodyText, status } = req.body;

  if (!who)  return res.status(400).json({ error: 'who is required' });
  if (!kind) return res.status(400).json({ error: 'kind is required' });

  if (status && !STATUS_KEYS.includes(status)) {
    return res.status(400).json({ error: `Invalid status: ${status}` });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Fetch the incident so we know its priority / site for the log entry
    const { rows: [inc] } = await client.query(
      'SELECT * FROM incidents WHERE id = $1',
      [incidentId]
    );
    if (!inc) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Incident not found' });
    }

    // 1. Insert thread event
    const { rows: [tRow] } = await client.query(
      `INSERT INTO incident_thread (incident_id, who, kind, action, body)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [incidentId, who, kind, action || null, bodyText || '']
    );

    // 2. Update incident status if provided
    if (status && status !== inc.status) {
      const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
      await client.query(
        `UPDATE incidents SET status = $1, resolved_at = COALESCE($2, resolved_at)
         WHERE id = $3`,
        [status, resolvedAt, incidentId]
      );
      inc.status     = status;
      inc.resolved_at = resolvedAt || inc.resolved_at;
    }

    // 3. Write a synthetic activity-log entry so the log column stays in sync
    const incLabel = 'INC-' + String(incidentId).padStart(4, '0');
    const logNote  = bodyText
      ? `${incLabel} · ${bodyText}`
      : `${incLabel} → ${status ? STATUS_LABEL[status] : kind}`;

    const { rows: [logEntryRow] } = await client.query(
      `INSERT INTO entries
         (template, caller_type, fields, category, priority, notes, dispatcher,
          is_incident, incident_id)
       VALUES ('system','system',$1,'Incident Update',$2,$3,$4,false,$5)
       RETURNING *`,
      [
        JSON.stringify({ ref: incLabel, site: inc.site || '' }),
        inc.priority,
        logNote,
        who,
        incidentId,
      ]
    );

    await client.query('COMMIT');

    // 4. Fetch full updated incident + thread to return
    const { rows: allThreadRows } = await client.query(
      'SELECT * FROM incident_thread WHERE incident_id = $1 ORDER BY ts ASC',
      [incidentId]
    );
    const { rows: [updatedInc] } = await client.query(
      `SELECT i.*, e.account_id AS account_id
         FROM incidents i
         LEFT JOIN entries e ON e.id = i.entry_id
        WHERE i.id = $1`,
      [incidentId]
    );

    return res.status(200).json({
      event:    toThreadEvent(tRow),
      incident: toIncident(updatedInc, allThreadRows.map(toThreadEvent)),
      logEntry: toEntry(logEntryRow),
    });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /api/incidents/[id]/thread error:', e);
    return res.status(500).json({ error: 'Failed to add thread event' });
  } finally {
    client.release();
  }
}

const STATUS_LABEL = {
  new: 'New', ack: 'Acknowledged', progress: 'In Progress',
  callback: 'Pending Callback', update: 'Awaiting Update', resolved: 'Resolved',
};
