// api/queue.js
// POST /api/queue
// Forwards a notification payload to the n8n webhook.
// Called internally by POST /api/entries, or directly by client for manual fires.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(503).json({ error: 'N8N_WEBHOOK_URL not configured' });
  }

  try {
    const upstream = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });
    const text = await upstream.text();
    return res.status(upstream.ok ? 200 : 502).json({
      ok:     upstream.ok,
      status: upstream.status,
      body:   text,
    });
  } catch (e) {
    console.error('queue webhook error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
