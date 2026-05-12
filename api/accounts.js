// api/accounts.js
// GET  /api/accounts   list all accounts (sorted by name)
// POST /api/accounts   create a new account

import { sql } from '@vercel/postgres';
import { toAccount } from '../lib/_db.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT * FROM accounts ORDER BY name ASC
    `;
    return res.status(200).json(rows.map(toAccount));
  }

  if (req.method === 'POST') {
    const { name, account_number, site, client_contact, client_email, client_phone, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const { rows: [row] } = await sql`
      INSERT INTO accounts (name, account_number, site, client_contact, client_email, client_phone, notes)
      VALUES (
        ${name.trim()},
        ${account_number || ''},
        ${site          || ''},
        ${client_contact|| ''},
        ${client_email  || ''},
        ${client_phone  || ''},
        ${notes         || ''}
      )
      RETURNING *
    `;
    return res.status(201).json(toAccount(row));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
