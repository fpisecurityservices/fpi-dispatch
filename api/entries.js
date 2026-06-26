// api/entries.js
// GET  /api/entries          list entries
// POST /api/entries          create entry (+ incident if is_incident)

import { sql, db } from '@vercel/postgres';
import { validateEntry, shouldAutoTrack, computeRoutes } from '../lib/enums.js';
import { toEntry, toIncident, toThreadEvent, toContact } from '../lib/_db.js';

export default async function handler(req, res) {

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { since, limit = '300', search } = req.query;
    const cap = Math.min(parseInt(limit) || 300, 1000);

    let rows;
    if (search) {
      const q = `%${search}%`;
      ({ rows } = await sql`
        SELECT * FROM entries
        WHERE (
          notes              ILIKE ${q} OR
          category           ILIKE ${q} OR
          dispatcher         ILIKE ${q} OR
          fields->>'callerName' ILIKE ${q} OR
          fields->>'guardName'  ILIKE ${q} OR
          fields->>'site'       ILIKE ${q} OR
          fields->>'unit'       ILIKE ${q}
        )
        ORDER BY ts DESC
        LIMIT ${cap}
      `);
    } else if (since) {
      ({ rows } = await sql`
        SELECT * FROM entries
        WHERE ts > ${since}::timestamptz
        ORDER BY ts DESC
        LIMIT ${cap}
      `);
    } else {
      ({ rows } = await sql`
        SELECT * FROM entries ORDER BY ts DESC LIMIT ${cap}
      `);
    }

    return res.status(200).json(rows.map(toEntry));
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body;

    // Normalise: client may send callerType or caller_type
    const payload = {
      template:    body.template,
      caller_type: body.caller_type || body.callerType,
      fields:      body.fields      || {},
      category:    body.category,
      priority:    body.priority,
      notes:       body.notes       || '',
      dispatcher:  body.dispatcher,
      is_incident: body.is_incident ?? false,
      account_id:  body.account_id  ?? null,
    };

    // Server-side validation
    const err = validateEntry({ ...payload, callerType: payload.caller_type });
    if (err) return res.status(400).json({ error: err });

    // Server enforces auto-track rule regardless of client flag
    if (shouldAutoTrack(payload.category, payload.priority)) {
      payload.is_incident = true;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert entry (incident_id added after incident is created)
      const { rows: [entRow] } = await client.query(
        `INSERT INTO entries
           (template, caller_type, fields, category, priority, notes, dispatcher, is_incident, account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          payload.template,
          payload.caller_type,
          JSON.stringify(payload.fields),
          payload.category,
          payload.priority,
          payload.notes,
          payload.dispatcher,
          payload.is_incident,
          payload.account_id,
        ]
      );

      let incidentRow = null;
      let threadRows  = [];

      if (payload.is_incident) {
        const title =
          payload.fields.guardName  ||
          payload.fields.callerName ||
          payload.fields.site       ||
          payload.category;

        // 2. Create incident
        const { rows: [iRow] } = await client.query(
          `INSERT INTO incidents
             (entry_id, opened_by, title, site, unit, callback, caller_name,
              category, priority, caller_type, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new')
           RETURNING *`,
          [
            entRow.id,
            payload.dispatcher,
            title,
            payload.fields.site     || '',
            payload.fields.unit     || '',
            payload.fields.callback || '',
            payload.fields.callerName || payload.fields.guardName || '',
            payload.category,
            payload.priority,
            payload.caller_type,
          ]
        );
        incidentRow = iRow;

        // 3. First thread event
        const { rows: [tRow] } = await client.query(
          `INSERT INTO incident_thread (incident_id, who, kind, action, body)
           VALUES ($1,$2,'create','opened incident',$3)
           RETURNING *`,
          [iRow.id, payload.dispatcher, payload.notes || 'Incident opened.']
        );
        threadRows = [tRow];

        // 4. Back-link entry to incident
        await client.query(
          `UPDATE entries SET incident_id = $1 WHERE id = $2`,
          [iRow.id, entRow.id]
        );
        entRow.incident_id = iRow.id;
      }

      await client.query('COMMIT');

      // 5. Compute routing and fire n8n
      let recipients = [];
      try {
        const { rows: ruleRows } = await sql`SELECT * FROM routing_rules`;
        const probe = {
          priority:    payload.priority,
          category:    payload.category,
          caller_type: payload.caller_type,
        };
        recipients = computeRoutes(probe, ruleRows);

        let webhookUrl = process.env.N8N_WEBHOOK_URL || '';
        if (!webhookUrl) {
          try {
            const { rows: cfgRows } = await sql`SELECT value FROM app_config WHERE key = 'webhook_url'`;
            webhookUrl = cfgRows[0]?.value || '';
          } catch { /* table may not exist yet */ }
        }
        if (webhookUrl) {
          const { rows: contactRows } = await sql`SELECT * FROM contacts`;

          // For "Take a Message", resolve the notify target to an email directly
          let notifyEmail = null;
          const notifyTarget = payload.fields?.notifyTarget;
          if (notifyTarget) {
            const match = contactRows.find(c => c.name === notifyTarget);
            notifyEmail = match?.email || null;
          }

          // Resolve routing recipients to full contact objects with emails
          const recipientContacts = recipients
            .map(name => contactRows.find(c => c.name === name))
            .filter(Boolean);

          const hasRecipientEmail =
            !!notifyEmail || recipientContacts.some(c => c.email);
          if (!hasRecipientEmail) {
            console.warn(
              `Skipping webhook for entry ${entRow.id}: no resolvable email ` +
              `(notifyTarget=${notifyTarget ?? 'none'}, recipients=[${recipients.join('|')}])`
            );
          } else {
          await fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entry:             toEntry(entRow),
              incident:          incidentRow ? toIncident(incidentRow, threadRows) : null,
              recipients,
              recipientContacts,
              notifyEmail,
              contacts:          contactRows,
              timestamp:         new Date().toISOString(),
            }),
          });
          }
        }
      } catch (e) {
        console.error('Routing/webhook error (non-fatal):', e.message);
      }

      return res.status(201).json({
        entry:      toEntry(entRow),
        incident:   incidentRow ? toIncident(incidentRow, threadRows) : null,
        recipients,
      });

    } catch (e) {
      await client.query('ROLLBACK');
      console.error('POST /api/entries error:', e);
      return res.status(500).json({ error: 'Failed to create entry' });
    } finally {
      client.release();
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
