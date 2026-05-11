// api/dispatchers/[name].js
// DELETE /api/dispatchers/:name   remove a dispatcher from the roster

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name } = req.query;
  await sql`DELETE FROM dispatchers WHERE name = ${decodeURIComponent(name)}`;
  return res.status(200).json({ deleted: decodeURIComponent(name) });
}
