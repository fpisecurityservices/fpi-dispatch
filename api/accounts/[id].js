// api/accounts/[id].js
import { sql } from '@vercel/postgres';

function toAccount(row) {
  return {
    id:            row.id,
    name:          row.name,
    accountNumber: row.account_number || '',
    site:          row.site           || '',
    clientContact: row.client_contact || '',
    clientEmail:   row.client_email   || '',
    clientPhone:   row.client_phone   || '',
    notes:         row.notes          || '',
  };
}

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'PATCH') {
    const { name, account_number, site, client_contact, client_email, client_phone, notes } = req.body;
    const { rows } = await sql`
      UPDATE accounts SET
        name           = COALESCE(${name            ?? null}, name),
        account_number = COALESCE(${account_number  ?? null}, account_number),
        site           = COALESCE(${site            ?? null}, site),
        client_contact = COALESCE(${client_contact  ?? null}, client_contact),
        client_email   = COALESCE(${client_email    ?? null}, client_email),
        client_phone   = COALESCE(${client_phone    ?? null}, client_phone),
        notes          = COALESCE(${notes           ?? null}, notes)
      WHERE id = ${id}
      RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(toAccount(rows[0]));
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM accounts WHERE id = ${id}`;
    return res.status(200).json({ deleted: parseInt(id) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
