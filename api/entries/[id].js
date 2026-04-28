const { sql } = require('@vercel/postgres');

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function addMinutesISO(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function getSlaMinutes() {
  const { rows } = await sql`
    SELECT key, value
    FROM app_settings
    WHERE key IN ('sla_critical_minutes', 'sla_high_minutes', 'sla_followup_minutes')
  `;
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    critical: toInt(map.sla_critical_minutes, 5),
    high: toInt(map.sla_high_minutes, 15),
    followup: toInt(map.sla_followup_minutes, 30),
  };
}

function computeDueAt(priority, workflowState, slaCfg) {
  if (workflowState === 'followup') return addMinutesISO(slaCfg.followup);
  if (priority === 'critical') return addMinutesISO(slaCfg.critical);
  if (priority === 'high') return addMinutesISO(slaCfg.high);
  return null;
}

async function logEvent(entryId, eventType, dispatcherName, payload = {}) {
  await sql`
    INSERT INTO entry_events (entry_id, event_type, dispatcher_name, payload)
    VALUES (${entryId}, ${eventType}, ${dispatcherName || ''}, ${JSON.stringify(payload)}::jsonb)
  `;
}

async function fireWebhook(alertType, level, entry, recipients) {
  // Always check DB first — this is what the user configures in the app Settings panel
  let url = null;
  try {
    const { rows } = await sql`SELECT value FROM app_settings WHERE key = 'webhook_url'`;
    url = rows[0]?.value;
  } catch (e) {}
  // Fall back to env var if DB has nothing
  if (!url) url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;

  // Get recipients from DB if not passed in
  let to = recipients;
  if (!to) {
    try {
      const { rows } = await sql`SELECT value FROM app_settings WHERE key = 'alert_recipients'`;
      to = rows[0]?.value || process.env.ALERT_RECIPIENTS || '';
    } catch (e) {
      to = process.env.ALERT_RECIPIENTS || '';
    }
  }

  const ts = new Date(entry.ts).toLocaleString('en-US');
  const body = [
    `ALERT:      ${alertType}`,
    `TIME:       ${ts}`,
    `DISPATCHER: ${entry.dispatcher_name || 'Dispatch'}`,
    `CALLER:     ${entry.caller_type}`,
    `GUARD/NAME: ${entry.guard_name || ''}`,
    `UNIT:       ${entry.unit_id || ''}`,
    `LOCATION:   ${entry.location || ''}`,
    `CATEGORY:   ${entry.category}`,
    `PRIORITY:   ${entry.priority}`,
    `NOTES:      ${entry.notes || ''}`,
    ``,
    `Entry #${entry.id} — FPI Dispatch`
  ].join('\n');

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertType, level,
        priority: entry.priority,
        callerType: entry.caller_type,
        guardName: entry.guard_name || '',
        unitId: entry.unit_id || '',
        location: entry.location || '',
        category: entry.category,
        notes: entry.notes || '',
        timestamp: new Date(entry.ts).toLocaleString('en-US'),
        entryId: entry.id,
        dispatcher: entry.dispatcher_name || 'Dispatch',
        recipients: to,
        emailBody: body
      })
    });
  } catch (e) {
    console.error('Webhook error:', e.message);
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const days = Math.min(parseInt(req.query.days) || 30, 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { rows } = await sql`
        SELECT * FROM entries
        WHERE ts > ${since}
        ORDER BY ts DESC
        LIMIT 1000
      `;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const b = req.body || {};

      if (!b.caller_type || !b.category) {
        return res.status(400).json({ error: 'caller_type and category are required' });
      }

      const priority = b.priority || 'medium';
      const workflowState = b.workflow_state || (b.status || 'new');
      const dispatcher = b.dispatcher_name || '';
      const sourceTemplate = b.source_template || null;

      const slaCfg = await getSlaMinutes();
      const dueAt = b.next_action_due_at || computeDueAt(priority, workflowState, slaCfg);

      const { rows } = await sql`
        INSERT INTO entries
          (
            caller_type, guard_name, unit_id, location, category, priority, notes, status,
            is_incident, is_ncns, dispatcher_name,
            owner_dispatcher_name, last_action_at, next_action_due_at, sla_state,
            source_template, comm_status, workflow_state
          )
        VALUES
          (
            ${b.caller_type}, ${b.guard_name || ''}, ${b.unit_id || ''}, ${b.location || ''},
            ${b.category}, ${priority}, ${b.notes || ''}, ${b.status || null},
            ${b.is_incident || false}, ${b.is_ncns || false}, ${dispatcher},
            ${b.owner_dispatcher_name || dispatcher || null}, NOW(), ${dueAt}, 'ok',
            ${sourceTemplate}, ${b.comm_status || 'internal'}, ${workflowState}
          )
        RETURNING *
      `;

      const entry = rows[0];

      await logEvent(entry.id, 'created', dispatcher, {
        source_template: sourceTemplate,
        workflow_state: entry.workflow_state,
        priority: entry.priority,
        due_at: entry.next_action_due_at
      });

      // Existing alert logic retained
      const { rows: cfg } = await sql`SELECT key, value FROM app_settings WHERE key LIKE 'alert_%'`;
      const settings = Object.fromEntries(cfg.map(r => [r.key, r.value === 'true']));
      const settingsRec = cfg.find(r => r.key === 'alert_recipients');
      const recipients = b.alertRecipients || settingsRec?.value || '';

      if (b.is_ncns && settings.alert_ncns) {
        await fireWebhook('NO CALL / NO SHOW', 'ncns', entry, recipients);
      } else if (priority === 'critical' && settings.alert_critical) {
        await fireWebhook('CRITICAL INCIDENT', 'critical', entry, recipients);
      } else if (priority === 'high' && settings.alert_high) {
        await fireWebhook('HIGH PRIORITY', 'high', entry, recipients);
      } else if (b.caller_type === 'client' && settings.alert_client) {
        await fireWebhook('CLIENT CALL', 'client', entry, recipients);
      }

      return res.status(201).json(entry);
    }

    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
