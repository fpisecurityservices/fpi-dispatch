const { sql } = require('@vercel/postgres');

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const days = Math.min(toInt(req.query.days, 30), 90);
    const limit = Math.min(toInt(req.query.limit, 500), 2000);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Pull active-ish entries first; frontend can still decide final rendering.
    const { rows } = await sql`
      SELECT
        id, ts, caller_type, guard_name, unit_id, location, category, priority, notes,
        status, is_incident, is_ncns, dispatcher_name,
        owner_dispatcher_name, last_action_at, next_action_due_at, sla_state,
        source_template, comm_status, resolved_at, workflow_state
      FROM entries
      WHERE ts > ${since}
        AND COALESCE(status, '') <> 'closed'
      ORDER BY ts DESC
      LIMIT ${limit}
    `;

    const nowMs = Date.now();

    const enriched = rows.map((e) => {
      const owner = e.owner_dispatcher_name || '';
      const wf = e.workflow_state || e.status || (e.is_incident ? 'new' : 'triaged');

      const dueAtMs = e.next_action_due_at ? new Date(e.next_action_due_at).getTime() : null;
      const minutesToDue = dueAtMs === null ? null : Math.round((dueAtMs - nowMs) / 60000);

      let due_state = 'none';
      if (dueAtMs !== null) {
        if (minutesToDue < 0) due_state = 'overdue';
        else if (minutesToDue <= 5) due_state = 'due_soon';
        else due_state = 'scheduled';
      }

      const isHigh = e.priority === 'high' || e.priority === 'critical';
      const isFollowup = wf === 'followup' || e.status === 'followup';
      const unassigned = isBlank(owner);

      let queue_bucket = 'normal';
      if (e.priority === 'critical') queue_bucket = 'critical';
      else if (e.priority === 'high') queue_bucket = 'high';
      else if (isFollowup) queue_bucket = 'followup';
      else if (unassigned) queue_bucket = 'unassigned';

      // lower rank = higher urgency
      const bucketRank =
        queue_bucket === 'critical' ? 1 :
        queue_bucket === 'high' ? 2 :
        queue_bucket === 'followup' ? 3 :
        queue_bucket === 'unassigned' ? 4 : 5;

      const dueRank =
        due_state === 'overdue' ? 1 :
        due_state === 'due_soon' ? 2 :
        due_state === 'scheduled' ? 3 : 4;

      return {
        ...e,
        workflow_state: wf,
        queue_bucket,
        due_state,
        minutes_to_due: minutesToDue,
        needs_action: queue_bucket !== 'normal' || due_state === 'overdue' || due_state === 'due_soon',
        at_risk: e.sla_state === 'breached' || due_state === 'overdue',
        unassigned,
        sort_rank: `${bucketRank}-${dueRank}`
      };
    });

    enriched.sort((a, b) => {
      const [ab, ad] = a.sort_rank.split('-').map(Number);
      const [bb, bd] = b.sort_rank.split('-').map(Number);
      if (ab !== bb) return ab - bb;
      if (ad !== bd) return ad - bd;

      // newer first if same rank
      return new Date(b.ts).getTime() - new Date(a.ts).getTime();
    });

    const payload = {
      meta: {
        generated_at: new Date().toISOString(),
        days,
        limit,
        total: enriched.length
      },
      all: enriched,
      needs_action: enriched.filter(e => e.needs_action),
      at_risk: enriched.filter(e => e.at_risk),
      unassigned: enriched.filter(e => e.unassigned),
      followup_due: enriched.filter(e => (e.workflow_state === 'followup' || e.status === 'followup') && (e.due_state === 'overdue' || e.due_state === 'due_soon'))
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
