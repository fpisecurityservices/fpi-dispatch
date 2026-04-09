const { sql } = require('@vercel/postgres');

async function fireWebhook(alertType, level, entry, recipients) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  const to = recipients || process.env.ALERT_RECIPIENTS || '';
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
        recipients: to
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
        SELECT * FROM entries WHERE ts > ${since} ORDER BY ts DESC LIMIT 1000
      `;
      return res.status(200).json(rows);
    }
    if (req.method === 'POST') {
      const b = req.body;
      const { rows } = await sql`
        INSERT INTO entries
          (caller_type, guard_name, unit_id, location, category, priority, notes, status, is_incident, is_ncns, dispatcher_name)
        VALUES
          (${b.caller_type}, ${b.guard_name || ''}, ${b.unit_id || ''}, ${b.location || ''},
           ${b.category}, ${b.priority || 'medium'}, ${b.notes || ''},
           ${b.status || null}, ${b.is_incident || false}, ${b.is_ncns || false},
           ${b.dispatcher_name || ''})
        RETURNING *
      `;
      const entry = rows[0];
      const { rows: cfg } = await sql`SELECT key, value FROM app_settings WHERE key LIKE 'alert_%'`;
      const settings = Object.fromEntries(cfg.map(r => [r.key, r.value === 'true']));
      const settingsRec = cfg.find(r => r.key === 'alert_recipients');
      const recipients = b.alertRecipients || settingsRec?.value || '';
      if (b.is_ncns && settings.alert_ncns) await fireWebhook('NO CALL / NO SHOW', 'ncns', entry, recipients);
      else if (b.priority === 'critical' && settings.alert_critical) await fireWebhook('CRITICAL INCIDENT', 'critical', entry, recipients);
      else if (b.priority === 'high' && settings.alert_high) await fireWebhook('HIGH PRIORITY', 'high', entry, recipients);
      else if (b.caller_type === 'client' && settings.alert_client) await fireWebhook('CLIENT CALL', 'client', entry, recipients);
      return res.status(201).json(entry);
    }
    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
