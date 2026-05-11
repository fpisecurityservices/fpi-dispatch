// api/webhook-test.js
// POST /api/webhook-test
// Fires a synthetic test payload to N8N_WEBHOOK_URL so you can verify
// the end-to-end notification pipeline without logging a real entry.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(503).json({ error: 'N8N_WEBHOOK_URL not configured' });
  }

  const testPayload = {
    test:       true,
    timestamp:  new Date().toISOString(),
    entry: {
      id:          0,
      ts:          new Date().toISOString(),
      template:    'system',
      callerType:  'dispatch',
      fields:      {},
      category:    'Shift Note',
      priority:    'low',
      notes:       'This is a test notification from the FPI Dispatch Portal.',
      dispatcher:  req.body?.dispatcher || 'System',
      is_incident: false,
      incident_id: null,
    },
    incident:   null,
    recipients: req.body?.recipients || ['Test Recipient'],
    contacts:   req.body?.contacts   || [],
  };

  try {
    const upstream = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(testPayload),
    });
    const text = await upstream.text();
    return res.status(200).json({
      ok:      upstream.ok,
      status:  upstream.status,
      payload: testPayload,
      body:    text,
    });
  } catch (e) {
    console.error('webhook-test error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
