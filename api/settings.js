// api/settings.js
// GET  /api/settings   return { rules, contacts, webhookUrl }
// POST /api/settings   wipe-and-replace both tables + save webhookUrl

import { db, sql } from '@vercel/postgres';
import { RULE_KEYS } from '../lib/enums.js';
import { toRule, toContact } from '../lib/_db.js';

async function getWebhookUrl() {
  try {
    const { rows } = await sql`SELECT value FROM app_config WHERE key = 'webhook_url'`;
    return (rows[0]?.value) || process.env.N8N_WEBHOOK_URL || '';
  } catch {
    return process.env.N8N_WEBHOOK_URL || '';
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const [{ rows: ruleRows }, { rows: contactRows }, webhookUrl] = await Promise.all([
      sql`SELECT * FROM routing_rules ORDER BY id`,
      sql`SELECT * FROM contacts       ORDER BY id`,
      getWebhookUrl(),
    ]);
    return res.status(200).json({
      rules:      ruleRows.map(toRule),
      contacts:   contactRows.map(toContact),
      webhookUrl,
    });
  }

  if (req.method === 'POST') {
    const { rules = [], contacts = [], webhookUrl } = req.body;

    // Validate rules
    for (const r of rules) {
      const eqIdx = (r.when || '').indexOf('=');
      if (eqIdx < 1) {
        return res.status(400).json({ error: `Bad rule when: "${r.when}"` });
      }
      const whenKey = r.when.slice(0, eqIdx);
      if (!RULE_KEYS.includes(whenKey)) {
        return res.status(400).json({ error: `Invalid rule key: ${whenKey}` });
      }
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM routing_rules');
      for (const r of rules) {
        const eqIdx   = r.when.indexOf('=');
        const whenKey = r.when.slice(0, eqIdx);
        const whenVal = r.when.slice(eqIdx + 1);
        const ruleId  = r.id || ('r' + Date.now() + Math.random().toString(36).slice(2,5));
        await client.query(
          `INSERT INTO routing_rules (id, when_key, when_value, to_recipients)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE
             SET when_key=EXCLUDED.when_key, when_value=EXCLUDED.when_value,
                 to_recipients=EXCLUDED.to_recipients`,
          [ruleId, whenKey, whenVal, JSON.stringify(r.to || [])]
        );
      }

      await client.query('DELETE FROM contacts');
      for (const c of contacts) {
        await client.query(
          `INSERT INTO contacts (name, role, email, phone)
           VALUES ($1,$2,$3,$4)`,
          [c.name, c.role || '', c.email || '', c.phone || '']
        );
      }

      if (typeof webhookUrl === 'string') {
        await client.query(
          `INSERT INTO app_config (key, value) VALUES ('webhook_url', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [webhookUrl.trim()]
        );
      }

      await client.query('COMMIT');

      // Return fresh state
      const [{ rows: ruleRows }, { rows: contactRows }, freshWebhookUrl] = await Promise.all([
        sql`SELECT * FROM routing_rules ORDER BY id`,
        sql`SELECT * FROM contacts       ORDER BY id`,
        getWebhookUrl(),
      ]);
      return res.status(200).json({
        rules:      ruleRows.map(toRule),
        contacts:   contactRows.map(toContact),
        webhookUrl: freshWebhookUrl,
      });

    } catch (e) {
      await client.query('ROLLBACK');
      console.error('POST /api/settings error:', e);
      return res.status(500).json({ error: 'Failed to save settings' });
    } finally {
      client.release();
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
