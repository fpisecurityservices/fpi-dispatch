const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = req.body;
    // Use URL from request body, fall back to DB, fall back to env var
    let webhookUrl = body.webhookUrl || process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      const { rows } = await sql`SELECT value FROM app_settings WHERE key = 'webhook_url'`;
      webhookUrl = rows[0]?.value;
    }
    if (!webhookUrl) return res.status(400).json({ error: 'No webhook URL configured' });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertType: 'TEST',
        level: 'info',
        priority: 'low',
        callerType: 'system',
        guardName: '',
        unitId: '',
        location: 'FPI Dispatch',
        category: 'System Test',
        notes: 'Test from FPI Dispatch Dashboard. Webhook is working.',
        timestamp: new Date().toLocaleString('en-US'),
        entryId: 0,
        dispatcher: 'System',
        recipients: body.recipients || ''
      })
    });

    if (response.ok) {
      res.status(200).json({ ok: true });
    } else {
      res.status(200).json({ ok: false, error: `Webhook returned ${response.status}` });
    }
  } catch (err) {
    console.error('Webhook test error:', err);
    res.status(200).json({ ok: false, error: err.message });
  }
};
