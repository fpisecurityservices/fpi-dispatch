// lib/_db.js
// Transforms DB row shapes (snake_case) into the camelCase shapes
// that dispatch.js expects. Import in every API handler.
 
export function toEntry(row) {
  if (!row) return null;
  return {
    id:          row.id,
    ts:          row.ts,
    template:    row.template,
    callerType:  row.caller_type,
    fields:      row.fields      || {},
    category:    row.category,
    priority:    row.priority,
    notes:       row.notes       || '',
    dispatcher:  row.dispatcher,
    is_incident: row.is_incident,
    incident_id: row.incident_id ?? null,
    account_id:  row.account_id  ?? null,
  };
}
 
export function toIncident(row, thread = []) {
  if (!row) return null;
  return {
    id:         row.id,
    entry_id:   row.entry_id    ?? null,
    openedAt:   row.opened_at,
    openedBy:   row.opened_by,
    title:      row.title,
    site:       row.site        || '',
    unit:       row.unit        || '',
    callback:   row.callback    || '',
    callerName: row.caller_name || '',
    category:   row.category,
    priority:   row.priority,
    callerType: row.caller_type,
    status:     row.status,
    resolvedAt: row.resolved_at ?? null,
    account_id: row.account_id  ?? null,
    thread:     thread.map(toThreadEvent),
  };
}
 
export function toThreadEvent(row) {
  return {
    id:     row.id,
    ts:     row.ts,
    who:    row.who,
    kind:   row.kind,
    action: row.action ?? null,
    body:   row.body   || '',
  };
}
 
export function toShift(row) {
  // dispatch.js uses 'name' for the dispatcher on a shift
  return {
    id:   row.id,
    ts:   row.ts,
    name: row.dispatcher,
    kind: row.kind,
    note: row.note || '',
  };
}
 
export function toRule(row) {
  // dispatch.js expects rules in {id, when:'key=value', to:[...]} format
  return {
    id:   row.id,
    when: `${row.when_key}=${row.when_value}`,
    to:   row.to_recipients || [],
  };
}
 
export function toAccount(row) {
  return {
    id:             row.id,
    name:           row.name,
    accountNumber:  row.account_number || '',
    site:           row.site           || '',
    clientContact:  row.client_contact || '',
    clientEmail:    row.client_email   || '',
    clientPhone:    row.client_phone   || '',
    notes:          row.notes          || '',
  };
}
 
export function toContact(row) {
  return {
    id:    row.id,
    name:  row.name,
    role:  row.role  || '',
    email: row.email || '',
    phone: row.phone || '',
  };
}
 
