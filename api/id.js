// api/bols/[id].js
// DELETE /api/bols/:id   clear a watch order

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const id = parseInt(req.query.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  if (req.method === 'DELETE') {
    await sql`DELETE FROM bols WHERE id = ${id}`;
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
