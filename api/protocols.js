// api/protocols.js
// GET  /api/protocols   list all escalation protocols (ordered)
// POST /api/protocols   wipe-and-replace the full protocol list
//
// Protocols are edited as a single ordered list in the reference tab, so the
// simplest reliable model is wipe-and-replace inside a transaction — the same
// pattern used by /api/settings.

import { db, sql } from '@vercel/postgres';
import { toProtocol } from '../lib/_db.js';

const TRIGGERS = ['critical', 'high', 'medium'];

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT * FROM escalation_protocols ORDER BY position, id
    `;
    return res.status(200).json(rows.map(toProtocol));
  }

  if (req.method === 'POST') {
    const { protocols = [] } = req.body || {};

    if (!Array.isArray(protocols)) {
      return res.status(400).json({ error: 'protocols must be an array' });
    }

    // Validate before touching the DB.
    for (const p of protocols) {
      if (!p || !String(p.category || '').trim()) {
        return res.status(400).json({ error: 'Each protocol needs a category' });
      }
      if (p.trigger && !TRIGGERS.includes(p.trigger)) {
        return res.status(400).json({ error: `Invalid trigger: ${p.trigger}` });
      }
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM escalation_protocols');

      for (let i = 0; i < protocols.length; i++) {
        const p = protocols[i];
        const steps = Array.isArray(p.steps)
          ? p.steps.map(s => String(s)).filter(s => s.trim())
          : [];
        await client.query(
          `INSERT INTO escalation_protocols (position, category, trigger_level, steps)
           VALUES ($1, $2, $3, $4)`,
          [i, p.category.trim(), p.trigger || 'medium', JSON.stringify(steps)]
        );
      }

      await client.query('COMMIT');

      const { rows } = await sql`
        SELECT * FROM escalation_protocols ORDER BY position, id
      `;
      return res.status(200).json(rows.map(toProtocol));
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('POST /api/protocols error:', e);
      return res.status(500).json({ error: 'Failed to save protocols' });
    } finally {
      client.release();
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
