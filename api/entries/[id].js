const { sql } = require('@vercel/postgres');

async function fireWebhook(alertType, level, entry, recipients) {
  // Keep existing behavior: env var endpoint
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertType, level,
        priority: entry.priority,
        callerType: entry.caller_type,
        guardName: entry.guard_name || '',
        location: entry.location || '',
        category: entry.category,
        notes: entry.notes || '',
        timestamp: new Date(entry.ts).toLocaleString('en-US'),
        entryId: entry.id,
        dispatcher: entry.dispatcher_name || 'Dispatch',
        recipients: recipients || process.env.ALERT_RECIPIENTS || ''
      })
    });
  } catch (e) {
    console.error('Webhook error:', e.message);
  }
}

async function logEvent(entryId, eventType, dispatcherName, payload = {}) {
  await sql`
    INSERT INTO entry_events (entry_id, event_type, dispatcher_name, payload)
    VALUES (${entryId}, ${eventType}, ${dispatcherName || ''}, ${JSON.stringify(payload)}::jsonb)
  `;
}

function resolveActor(bodyDispatcher, entryRow) {
  return (
    bodyDispatcher ||
    entryRow?.owner_dispatcher_name ||
    entryRow?.dispatcher_name ||
    'Dispatch'
  );
}

module.exports = async function handler(req, res) {
  const id = parseInt(req.query.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

  try {
    if (req.method !== 'PATCH') {
      return res.status(405).end();
    }
    if (req.method !== 'PATCH') return res.status(405).end();

    const b = req.body || {};
    const action = b.action || 'legacy';
    const actor = b.dispatcher_name || '';

    let rows;

    // 1) Assign owner and optionally set workflow state
    if (action === 'assign') {
      ({ rows } = await sql`
        UPDATE entries
        SET owner_dispatcher_name = ${b.owner_dispatcher_name || null},
            workflow_state = COALESCE(${b.workflow_state || null}, workflow_state),
            last_action_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);

      if (!rows?.length) return res.status(404).json({ error: 'Not found' });

      const entry = rows[0];
      const eventActor = resolveActor(actor, entry);

      await logEvent(id, 'assigned', eventActor, {
      await logEvent(id, 'assigned', resolveActor(actor, entry), {
        owner_dispatcher_name: b.owner_dispatcher_name || null,
        workflow_state: b.workflow_state || null
      });

      return res.status(200).json(entry);
    }

    // 2) Communication status update (+ optional note append)
    if (action === 'comm') {
      ({ rows } = await sql`
        UPDATE entries
        SET comm_status = ${b.comm_status || 'internal'},
            notes = CASE
              WHEN ${b.append_note || ''} = '' THEN notes
              ELSE CONCAT(notes, CASE WHEN notes = '' THEN '' ELSE E'\n' END, ${b.append_note})
            END,
            last_action_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);

      if (!rows?.length) return res.status(404).json({ error: 'Not found' });

      const entry = rows[0];
      const eventActor = resolveActor(actor, entry);

      await logEvent(id, 'comm_updated', eventActor, {
      await logEvent(id, 'comm_updated', resolveActor(actor, entry), {
        comm_status: b.comm_status || 'internal',
        note: b.append_note || ''
      });

      return res.status(200).json(entry);
    }

    // 3) Update due date / SLA state
    if (action === 'due') {
      ({ rows } = await sql`
        UPDATE entries
        SET next_action_due_at = ${b.next_action_due_at || null},
            sla_state = COALESCE(${b.sla_state || null}, sla_state),
            last_action_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);

      if (!rows?.length) return res.status(404).json({ error: 'Not found' });

      const entry = rows[0];
      const eventActor = resolveActor(actor, entry);

      await logEvent(id, 'due_updated', eventActor, {
      await logEvent(id, 'due_updated', resolveActor(actor, entry), {
        next_action_due_at: b.next_action_due_at || null,
        sla_state: b.sla_state || null
      });

      return res.status(200).json(entry);
    }

    // 4) Close incident
    if (action === 'close') {
      ({ rows } = await sql`
        UPDATE entries
        SET status = 'closed',
            workflow_state = 'closed',
            resolved_at = NOW(),
            sla_state = 'ok',
            last_action_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);

      if (!rows?.length) return res.status(404).json({ error: 'Not found' });

      const entry = rows[0];
      const eventActor = resolveActor(actor, entry);

      await logEvent(id, 'closed', eventActor, {});
      await logEvent(id, 'closed', resolveActor(actor, entry), {});
      return res.status(200).json(entry);
    }

    // Legacy compatibility path (existing behavior + last_action/event logging)
    const { status, is_incident } = b;

    if (status !== undefined && is_incident !== undefined) {
      ({ rows } = await sql`
        UPDATE entries
        SET status = ${status},
            is_incident = ${is_incident},
            workflow_state = COALESCE(${status}, workflow_state),
            last_action_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      ({ rows } = await sql`UPDATE entries SET status = ${status}, is_incident = ${is_incident}, workflow_state = COALESCE(${status}, workflow_state), last_action_at = NOW() WHERE id = ${id} RETURNING *`);
    } else if (status !== undefined) {
      ({ rows } = await sql`
        UPDATE entries
        SET status = ${status},
            workflow_state = COALESCE(${status}, workflow_state),
            last_action_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      ({ rows } = await sql`UPDATE entries SET status = ${status}, workflow_state = COALESCE(${status}, workflow_state), last_action_at = NOW() WHERE id = ${id} RETURNING *`);
    } else if (is_incident !== undefined) {
      ({ rows } = await sql`
        UPDATE entries
        SET is_incident = ${is_incident},
            status = 'new',
            workflow_state = 'new',
            last_action_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      ({ rows } = await sql`UPDATE entries SET is_incident = ${is_incident}, status = 'new', workflow_state = 'new', last_action_at = NOW() WHERE id = ${id} RETURNING *`);
    } else {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    if (!rows?.length) return res.status(404).json({ error: 'Not found' });

    const entry = rows[0];

    // Keep existing follow-up alert behavior
    if (status === 'followup') {
      const { rows: cfg } = await sql`SELECT value FROM app_settings WHERE key = 'alert_followup'`;
      if (cfg[0]?.value === 'true') {
        const { rows: rec } = await sql`SELECT value FROM app_settings WHERE key = 'alert_recipients'`;
        await fireWebhook(
          'FOLLOW-UP REQUIRED',
          'followup',
          entry,
          b.alertRecipients || rec[0]?.value
        );
        await fireWebhook('FOLLOW-UP REQUIRED', 'followup', entry, b.alertRecipients || rec[0]?.value);
      }
    }

    const eventActor = resolveActor(actor, entry);

    await logEvent(id, 'updated', eventActor, {
    await logEvent(id, 'updated', resolveActor(actor, entry), {
      status: b.status,
      is_incident: b.is_incident
    });

    return res.status(200).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
