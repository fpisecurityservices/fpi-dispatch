const { sql } = require('@vercel/postgres');

async function fireWebhook(alertType, level, entry, recipients) {
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

module.exports = async function handler(req, res) {
  const id = parseInt(req.query.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    if (req.method === 'PATCH') {
      const { status, is_incident } = req.body;
      let rows;
      if (status !== undefined && is_incident !== undefined) {
        ({ rows } = await sql`UPDATE entries SET status = ${status}, is_incident = ${is_incident} WHERE id = ${id} RETURNING *`);
      } else if (status !== undefined) {
        ({ rows } = await sql`UPDATE entries SET status = ${status} WHERE id = ${id} RETURNING *`);
      } else if (is_incident !== undefined) {
        ({ rows } = await sql`UPDATE entries SET is_incident = ${is_incident}, status = 'new' WHERE id = ${id} RETURNING *`);
      } else {
        return res.status(400).json({ error: 'Nothing to update' });
      }
      if (!rows?.length) return res.status(404).json({ error: 'Not found' });
      const entry = rows[0];
      if (status === 'followup') {
        const { rows: cfg } = await sql`SELECT value FROM app_settings WHERE key = 'alert_followup'`;
        if (cfg[0]?.value === 'true') {
          const { rows: rec } = await sql`SELECT value FROM app_settings WHERE key = 'alert_recipients'`;
          await fireWebhook('FOLLOW-UP REQUIRED', 'followup', entry, req.body.alertRecipients || rec[0]?.value);
        }
      }
      return res.status(200).json(entry);
    }
    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
