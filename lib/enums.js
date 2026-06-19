// ============================================================================
// lib/enums.js
//
// Shared between the browser (public/dispatch.js) and the serverless API
// handlers in /api. Single source of truth for status / priority / category /
// caller-type values, plus a couple of validation helpers used on both sides.
//
// This file is written as ES modules. If your project uses CommonJS, change
// the `export` keywords to a single `module.exports = { ... }` at the bottom.
//
// In the browser, import via `<script type="module">` or bundle into
// dispatch.js. Keep the file path identical on both sides so the constants
// match exactly.
// ============================================================================

// Status keys map 1:1 to incidents.status. Any change here MUST be mirrored in
// the CHECK constraint in migrations/001_init_v2_schema.sql or inserts fail.
export const STATUS = {
  new:      { label: 'New',              color: 'st-new' },
  ack:      { label: 'Acknowledged',     color: 'st-ack' },
  progress: { label: 'In Progress',      color: 'st-progress' },
  callback: { label: 'Pending Callback', color: 'st-callback' },
  update:   { label: 'Awaiting Update',  color: 'st-update' },
  resolved: { label: 'Resolved',         color: 'st-resolved' },
};
export const STATUS_KEYS = Object.keys(STATUS);

export const PRIORITIES = [
  { key: 'low',      label: 'Low',  color: '#2A9D5C' },
  { key: 'medium',   label: 'Med',  color: '#647184' },
  { key: 'high',     label: 'High', color: '#E0862A' },
  { key: 'critical', label: 'CRIT', color: '#C0392B' },
];
export const PRIORITY_KEYS = PRIORITIES.map(p => p.key);

export const TEMPLATES = [
  { key: 'phone',  label: 'Phone Call',    icon: 'phone',          placeholder: 'Caller said…',                          track: false, def: { callerType: 'public' } },
  { key: 'guard',  label: 'Guard / Field', icon: 'radio',          placeholder: 'Officer / post update…',                track: false, def: { callerType: 'guard' } },
  { key: 'system', label: 'System / Note', icon: 'clipboard-list', placeholder: 'Internal note, observation, BOL, etc.', track: false, def: { callerType: 'system' } },
];
export const TEMPLATE_KEYS = TEMPLATES.map(t => t.key);

export const CATEGORIES = {
  phone:  ['Incident Report','Client Inquiry','Complaint','Vehicle / Accident','Alarm','HR Issue','eHub Issues','Time Off Request','Disciplinary Action','Equipment Issue','Take a Message','Callout','Other'],
  guard:  ['Patrol Check-in','Post Check','No Call / No Show','Late to Post','Post Abandoned','Incident Report','Equipment Issue','Other'],
  system: ['Scheduling','Maintenance','Uniform Return','Alarm','Additional Service Request','Activity Audit','Other'],
};
export const ALL_CATEGORIES = Array.from(new Set([
  ...CATEGORIES.phone, ...CATEGORIES.guard, ...CATEGORIES.system,
]));

export const CALLER_TYPES = {
  phone:  [{ key: 'public',     icon: 'user',         label: 'Public' },
           { key: 'client',     icon: 'briefcase',    label: 'Client' },
           { key: 'guard',      icon: 'shield',       label: 'Guard' }],
  guard:  [{ key: 'guard',      icon: 'shield',       label: 'Guard' },
           { key: 'supervisor', icon: 'shield-check', label: 'Supervisor' },
           { key: 'client',     icon: 'briefcase',    label: 'On-site Client' }],
  system: [{ key: 'system',     icon: 'cpu',          label: 'System' },
           { key: 'dispatch',   icon: 'headphones',   label: 'Dispatch Note' }],
};
export const CALLER_TYPE_KEYS = ['public','client','guard','supervisor','system','dispatch'];

export const QUICK_ACTIONS = [
  { key: 'checkin', cat: 'Patrol Check-in',   pri: 'low',      tpl: 'guard',  track: false, label: 'Check-in' },
  { key: 'ncns',    cat: 'No Call / No Show', pri: 'high',     tpl: 'guard',  track: true,  label: 'NCNS' },
  { key: 'late',    cat: 'Late to Post',      pri: 'medium',   tpl: 'guard',  track: true,  label: 'Late to Post' },
  { key: 'abandon', cat: 'Post Abandoned',    pri: 'critical', tpl: 'guard',  track: true,  label: 'Post Abandoned' },
  { key: 'sched',   cat: 'Scheduling',        pri: 'medium',   tpl: 'system', track: false, label: 'Scheduling' },
];

// Categories that auto-enable "Track as Incident" on the form. Server should
// also auto-set is_incident=true when any of these are present, so a buggy or
// stale client can't bypass the rule.
export const SERIOUS_CATEGORIES = [
  'No Call / No Show', 'Post Abandoned', 'Incident Report',
  'Alarm', 'Medical', 'Suspicious Person', 'Trespassing', 'Disturbance',
];

export const THREAD_KINDS = ['create','status','update','resolve','callback','handoff'];
export const SHIFT_KINDS  = ['start','handoff','end'];
export const RULE_KEYS    = ['priority','category','callerType'];

// ----------------------------------------------------------------------------
// Validation + business logic helpers — use these on the server.
// ----------------------------------------------------------------------------

// Returns null if the entry is valid, or a string describing the first
// validation failure. Use in POST /api/entries before insert.
export function validateEntry(e) {
  if (!e || typeof e !== 'object') return 'entry must be an object';
  if (!TEMPLATE_KEYS.includes(e.template))       return `bad template: ${e.template}`;
  if (!CALLER_TYPE_KEYS.includes(e.caller_type)) return `bad caller_type: ${e.caller_type}`;
  if (!PRIORITY_KEYS.includes(e.priority))       return `bad priority: ${e.priority}`;
  if (!e.category || !ALL_CATEGORIES.includes(e.category)) return `bad category: ${e.category}`;
  if (typeof e.dispatcher !== 'string' || !e.dispatcher.trim()) return 'missing dispatcher';
  return null;
}

// Whether an entry should be auto-tracked as an incident based on its
// category and priority alone. Server should OR this with the client's
// explicit is_incident flag.
export function shouldAutoTrack(category, priority) {
  return SERIOUS_CATEGORIES.includes(category)
      || priority === 'critical'
      || priority === 'high';
}

// Evaluate routing rules against an entry. Returns deduped recipient strings.
// Rules from Postgres are shaped as { when_key, when_value, to_recipients }.
export function computeRoutes(entry, rules) {
  const map = {
    priority:   entry.priority,
    category:   entry.category,
    callerType: entry.caller_type,
  };
  const out = new Set();
  for (const r of rules || []) {
    if (map[r.when_key] === r.when_value) {
      for (const t of (r.to_recipients || [])) out.add(t);
    }
  }
  return Array.from(out);
}
