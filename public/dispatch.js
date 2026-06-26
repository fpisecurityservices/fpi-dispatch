/* ============================================================
   FPI Dispatch — Operations Portal v2
   Data layer: Vercel Postgres via /api/* serverless functions.
   ============================================================ */

/* -------- TEMPLATES (capture modes) -------- */
const TEMPLATES = [
  {key:'phone',  label:'Phone Call',     icon:'phone',         placeholder:'Caller said…',                            track:false, def:{callerType:'public'}},
  {key:'system', label:'Dispatch Notes', icon:'clipboard-list',placeholder:'Internal note, observation, BOL, etc.',   track:false, def:{callerType:'system'}}
];

const QUICK_ACTIONS = [
  {key:'checkin',  cat:'Patrol Check-in',     pri:'low',      tpl:'phone', track:false, label:'Check-in'},
  {key:'callout',  cat:'Callout',             pri:'high',     tpl:'phone', track:true,  label:'Callout'},
  {key:'ncns',     cat:'No Call / No Show',   pri:'high',     tpl:'phone', track:true,  label:'NCNS'},
  {key:'late',     cat:'Late to Post',        pri:'medium',   tpl:'phone', track:true,  label:'Late to Post'},
  {key:'abandon',  cat:'Post Abandoned',      pri:'critical', tpl:'phone', track:true,  label:'Post Abandoned'},
  {key:'sched',    cat:'Scheduling',          pri:'medium',   tpl:'system',track:false, label:'Scheduling'}
];

const CATEGORIES = {
  phone:  ['Incident Report','Client Inquiry','Complaint','Vehicle / Accident','Alarm','HR Issue','eHub Issues','Time Off Request','Disciplinary Action','Equipment Issue','Take a Message','Callout','Other'],
  guard:  ['Patrol Check-in','Post Check','No Call / No Show','Late to Post','Post Abandoned','Incident Report','Equipment Issue','Other'],
  system: ['Scheduling','Maintenance','Uniform Return','Alarm','Additional Service Request','Activity Audit','Other'],
};

const PRIORITIES = [
  {key:'low',     label:'Low',  color:'#2A9D5C'},
  {key:'medium',  label:'Med',  color:'#647184'},
  {key:'high',    label:'High', color:'#E0862A'},
  {key:'critical',label:'CRIT', color:'#C0392B'}
];

const CALLER_TYPES = {
  phone:  [{key:'public',icon:'user',label:'Public'},{key:'client',icon:'briefcase',label:'Client'},{key:'guard',icon:'shield',label:'Guard'}],
  guard:  [{key:'guard',icon:'shield',label:'Guard'},{key:'supervisor',icon:'shield-check',label:'Supervisor'},{key:'client',icon:'briefcase',label:'On-site Client'}],
  system: [{key:'system',icon:'cpu',label:'System'},{key:'dispatch',icon:'headphones',label:'Dispatch Note'}]
};

const STATUS = {
  new:      {label:'New',           color:'st-new'},
  ack:      {label:'Acknowledged',  color:'st-ack'},
  progress: {label:'In Progress',   color:'st-progress'},
  callback: {label:'Pending Callback', color:'st-callback'},
  update:   {label:'Awaiting Update',  color:'st-update'},
  resolved: {label:'Resolved',      color:'st-resolved'}
};

/* -------- DEFAULT ROUTING RULES -------- */
const DEFAULT_RULES = [
  {id:'r1', when:'priority=critical',          to:['Daniel R. (Ops Mgr)','Field Supervisor','Account Manager']},
  {id:'r2', when:'priority=high',              to:['Daniel R. (Ops Mgr)','Field Supervisor']},
  {id:'r3', when:'category=No Call / No Show', to:['Scheduling Lead','Field Supervisor']},
  {id:'r4', when:'category=Post Abandoned',    to:['Daniel R. (Ops Mgr)','Field Supervisor','Account Manager']},
  {id:'r5', when:'callerType=client',          to:['Account Manager']},
  {id:'r6', when:'category=Client Inquiry',    to:['Account Manager']},
  {id:'r7', when:'category=Medical',           to:['Daniel R. (Ops Mgr)','Field Supervisor']},
  {id:'r8', when:'category=Scheduling',        to:['Scheduling Lead']}
];

const DEFAULT_CONTACTS = [
  {name:'Daniel R.',        role:'Ops Manager',     email:'daniel@fpisecurity.com'},
  {name:'Field Supervisor', role:'Field Sup. (on duty)', email:'field-sup@fpisecurity.com'},
  {name:'Scheduling Lead',  role:'Scheduling',      email:'scheduling@fpisecurity.com'},
  {name:'Account Manager',  role:'Client Accounts', email:'accounts@fpisecurity.com'}
];

const DEFAULT_DISPATCHERS = ['Rosa M.','Carlos D.','Aisha P.','James W.'];

/* -------- STATE -------- */
const ST = {
  entries: [],          // unified log: phone calls, system notes, AND incident records
  incidents: [],        // incidents == entries[].is_incident, but we keep a separate list with threads
  shifts: [],
  dispatcher: null,
  template: 'phone',
  fm: {callerType:null, category:null, priority:'medium', notes:'', fields:{}, track:false},
  rules: [],
  contacts: [],
  dispatchers: [],
  accounts: [],
  selectedAccount: null,
  logFilter: 'all',
  dateFilter: 7,
  expanded: new Set(),
  addingUpdateTo: null,
  bols: JSON.parse(localStorage.getItem('fpi_bols')||'[]'),
  guards: []
};

/* -------- API DATA LAYER -------- */

// IDs come from the database now — these are display-only formatters.
function fmtIncId(n){ return 'INC-' + String(n).padStart(4,'0'); }
function fmtEntId(n){ return 'E-'   + String(n).padStart(5,'0'); }

// Dispatcher name persists across page refreshes via sessionStorage.
// Opens fresh on a new tab (appropriate for a shared workstation).
const SESSION_KEY = 'fpi_dispatcher';

function persist(){ /* no-op — all writes go through individual API calls */ }

function hydrateEntry(e){
  e.ts = new Date(e.ts);
  return e;
}
function hydrateIncident(i){
  i.openedAt = new Date(i.openedAt);
  if(i.resolvedAt) i.resolvedAt = new Date(i.resolvedAt);
  (i.thread||[]).forEach(t => t.ts = new Date(t.ts));
  return i;
}
function hydrateShift(s){
  s.ts = new Date(s.ts);
  return s;
}

async function loadState(){
  try{
    const [entries, incidents, shifts, dispatchers, settings, accounts] = await Promise.all([
      fetch('/api/entries?limit=500').then(r=>r.json()),
      fetch('/api/incidents').then(r=>r.json()),
      fetch('/api/shifts').then(r=>r.json()),
      fetch('/api/dispatchers').then(r=>r.json()),
      fetch('/api/settings').then(r=>r.json()),
      fetch('/api/accounts').then(r=>r.json()),
    ]);
    ST.entries     = (entries    ||[]).map(hydrateEntry);
    ST.incidents   = (incidents  ||[]).map(hydrateIncident);
    ST.shifts      = (shifts     ||[]).map(hydrateShift);
    ST.dispatchers = dispatchers ||[];
    ST.rules       = settings.rules    ||[];
    ST.contacts    = settings.contacts ||[];
    ST.accounts    = accounts          ||[];
    ST.dispatcher  = sessionStorage.getItem(SESSION_KEY)||null;
  }catch(e){
    toast('Failed to load data','danger','Check your connection and refresh.');
    console.error('loadState error:', e);
  }
}

async function apiPost(path, body){
  const r = await fetch(path,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if(!r.ok){
    const err = await r.json().catch(()=>({error:r.statusText}));
    throw new Error(err.error||r.statusText);
  }
  return r.json();
}
async function apiPatch(path, body){
  const r = await fetch(path,{
    method:'PATCH',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if(!r.ok){
    const err = await r.json().catch(()=>({error:r.statusText}));
    throw new Error(err.error||r.statusText);
  }
  return r.json();
}
async function apiDelete(path){
  const r = await fetch(path,{method:'DELETE'});
  if(!r.ok) throw new Error(r.statusText);
  return r.json();
}

/* -------- ROUTING ENGINE -------- */
function computeRoutes(entry){
  const matched = new Set();
  for(const r of ST.rules){
    const [k,v] = r.when.split('=');
    if(entry[k]===v) r.to.forEach(t=>matched.add(t));
  }
  return Array.from(matched);
}

/* -------- RENDER: TEMPLATES + FORM -------- */
function renderTemplateTabs(){
  document.getElementById('cap-tabs').innerHTML = TEMPLATES.map(t=>`
    <button type="button" class="cap-tab ${ST.template===t.key?'active':''}" onclick="setTemplate('${t.key}')">
      <i data-lucide="${t.icon}"></i>${t.label}
    </button>
  `).join('');
  refreshIcons();
}

function renderCallerRow(){
  const callerFld = document.getElementById('caller-row').closest('.fld');
  if(ST.template === 'system'){
    if(callerFld) callerFld.style.display = 'none';
    return;
  }
  if(callerFld) callerFld.style.display = '';
  const opts = CALLER_TYPES[ST.template] || CALLER_TYPES.phone;
  document.getElementById('caller-row').innerHTML = opts.map(o=>`
    <button type="button" class="caller-pill ${ST.fm.callerType===o.key?'sel':''}" onclick="setCallerType('${o.key}')">
      <i data-lucide="${o.icon}"></i>${o.label}
    </button>
  `).join('');
  refreshIcons();
}

function renderAccountDropdown(){
  if(!ST.accounts.length) return '';
  const sel = ST.selectedAccount;
  const opts = ST.accounts.map(a=>
    `<option value="${a.id}" ${sel&&sel.id===a.id?'selected':''}>${esc(a.name)}${a.accountNumber?' ('+esc(a.accountNumber)+')':''}</option>`
  ).join('');
  const notesHtml = sel&&sel.notes
    ? `<div style="font-size:11px;color:#64748b;margin-top:4px;padding:4px 6px;background:#f1f5f9;border-radius:4px;">&#128203; ${esc(sel.notes)}</div>`
    : '';
  return `
    <div class="fld">
      <div class="fld-label">Account</div>
      <select class="inp" id="f-account-sel" onchange="selectAccount(this.value)" style="cursor:pointer;">
        <option value="">-- Select account --</option>
        ${opts}
      </select>
      ${notesHtml}
    </div>
  `;
}

function selectAccount(idStr){
  if(!idStr){ ST.selectedAccount=null; renderDynFields(); return; }
  const acc = ST.accounts.find(a=>a.id===parseInt(idStr));
  ST.selectedAccount = acc||null;
  if(acc && acc.site){
    ST.fm.fields.site    = acc.site;
    ST.fm.fields.account = acc.name;
  }
  renderDynFields();
}

function renderDynFields(){
  const t = ST.template;
  const accDrop = renderAccountDropdown();
  let html = '';
  if(t==='phone'){
    const notifyDrop = ST.fm.category === 'Take a Message' ? `
      <div class="fld">
        <div class="fld-label">Notify</div>
        <select class="inp" id="f-notify" onchange="updField('notifyTarget',this.value)">
          <option value="">\u2014 Select recipient \u2014</option>
          ${ST.contacts.map(c=>`<option value="${esc(c.name)}" ${ST.fm.fields.notifyTarget===c.name?'selected':''}>${esc(c.name)}${c.role?' \u00b7 '+esc(c.role):''}</option>`).join('')}
        </select>
      </div>` : '';
    html = accDrop + `
      <div class="fld">
        <div class="fld-label">Site / Property</div>
        <input class="inp" id="f-site" placeholder="Property or location\u2026" value="${esc(ST.fm.fields.site||'')}" oninput="updField('site',this.value)">
      </div>
      ${notifyDrop}
      <div class="fld">
        <div class="fld-label">Caller Info</div>
        <input class="inp" id="f-callerName" placeholder="Caller name\u2026" value="${esc(ST.fm.fields.callerName||'')}" oninput="updField('callerName',this.value)">
        <div class="fld-row" style="margin-top:6px;">
          <input class="inp inp-mono" id="f-callback" placeholder="Callback #" value="${esc(ST.fm.fields.callback||'')}" oninput="updField('callback',this.value)">
        </div>
      </div>
    `;
  } else if(t==='guard'){
    html = accDrop + `
      <div class="fld">
        <div class="fld-label">Site</div>
        <input class="inp" id="f-site" placeholder="Property\u2026" value="${esc(ST.fm.fields.site||'')}" oninput="updField('site',this.value)">
      </div>
      <div class="fld">
        <div class="fld-label">Officer</div>
        <input class="inp" id="f-guardName" placeholder="Officer name\u2026" value="${esc(ST.fm.fields.guardName||'')}" oninput="updField('guardName',this.value)">
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        ${QUICK_ACTIONS.map(q=>`<button type="button" class="chip ${ST.fm.category===q.cat?'sel':''}" onclick="applyQuick('${q.key}')">${q.label}</button>`).join('')}
      </div>
    `;
  } else if(t==='system'){
    html = accDrop + `
      <div class="fld">
        <div class="fld-label">Reference (optional)</div>
        <input class="inp" id="f-ref" placeholder="Related site, account, or unit\u2026" value="${esc(ST.fm.fields.site||'')}" oninput="updField('site',this.value)">
      </div>
    `;
  }
  document.getElementById('dyn-fields').innerHTML = html;
}

function renderCatGrid(){
  const cats = CATEGORIES[ST.template] || CATEGORIES.phone;
  document.getElementById('cat-grid').innerHTML = cats.map(c=>`
    <button type="button" class="chip ${ST.fm.category===c?'sel':''}" onclick="setCategory(${JSON.stringify(c).replace(/"/g,'&quot;')})">${c}</button>
  `).join('');
}

function renderPriRow(){
  const map={low:'sel-low',medium:'sel-med',high:'sel-high',critical:'sel-crit'};
  document.getElementById('pri-row').innerHTML = PRIORITIES.map(p=>`
    <button type="button" class="pri-btn ${ST.fm.priority===p.key?map[p.key]:''}" onclick="setPriority('${p.key}')">
      <span class="pri-dot" style="${ST.fm.priority===p.key?'':'background:'+p.color}"></span>
      ${p.label}
    </button>
  `).join('');
}

function renderRouting(){
  const el = document.getElementById('route-list');
  if(!ST.fm.category || !ST.fm.priority){
    el.innerHTML = `<div class="route-empty">No notifications yet — select a category</div>`;
    return;
  }
  const probe = {
    callerType: ST.fm.callerType,
    category: ST.fm.category,
    priority: ST.fm.priority
  };
  const routes = computeRoutes(probe);
  if(!routes.length){
    el.innerHTML = `<div class="route-empty">Logged silently — no rule triggers a notification</div>`;
    return;
  }
  el.innerHTML = routes.map(r=>{
    const ct = ST.contacts.find(c=>r.indexOf(c.name)>-1);
    const role = ct ? ct.role : '';
    return `<span class="route-chip"><i data-lucide="bell"></i>${esc(r.replace(/\s*\(.*\)/,''))}${role?`<span style="color:var(--n400);font-weight:500;">· ${esc(role)}</span>`:''}</span>`;
  }).join('');
  refreshIcons();
}

function renderTrackRow(){
  const row = document.getElementById('track-row');
  const tgl = document.getElementById('track-tgl');
  const tt = document.getElementById('track-tt');
  row.classList.toggle('on', ST.fm.track);
  tgl.classList.toggle('on', ST.fm.track);
  tt.textContent = ST.fm.track ? 'Tracking as Active Incident' : 'Track as Active Incident';
}

/* -------- FORM ACTIONS -------- */
function setTemplate(k){
  ST.template = k;
  ST.fm.callerType = k === 'system' ? 'system' : (CALLER_TYPES[k][0]||{}).key;
  ST.fm.category = null;
  ST.fm.fields = {};
  ST.fm.track = false;
  const t = TEMPLATES.find(t=>t.key===k);
  document.getElementById('notes').placeholder = t.placeholder;
  renderAll();
}
function setCallerType(c){ ST.fm.callerType = c; renderCallerRow(); renderRouting(); }
function setCategory(c){
  ST.fm.category = c;
  // Auto-suggest tracking for serious categories
  const serious = ['No Call / No Show','Post Abandoned','Incident Report','Alarm','Medical','Suspicious Person','Trespassing','Disturbance'];
  if(serious.includes(c) || ST.fm.priority==='critical' || ST.fm.priority==='high'){
    ST.fm.track = true;
  }
  renderDynFields(); renderCatGrid(); renderRouting(); renderTrackRow();
}
function setPriority(p){
  ST.fm.priority = p;
  if(p==='critical'||p==='high') ST.fm.track = true;
  renderPriRow(); renderRouting(); renderTrackRow();
}
function updField(k,v){ ST.fm.fields[k] = v; }
function toggleTrack(){ ST.fm.track = !ST.fm.track; renderTrackRow(); }

function applyQuick(key){
  const q = QUICK_ACTIONS.find(x=>x.key===key);
  // Preserve typed field values across quick action clicks
  const savedFields = {...ST.fm.fields};
  if(ST.template !== q.tpl){
    setTemplate(q.tpl);
  }
  ST.fm.fields   = savedFields;
  ST.fm.category = q.cat;
  ST.fm.priority = q.pri;
  ST.fm.track    = q.track;
  renderAll();
  document.getElementById('f-guardName')?.focus();
}

function resetForm(){
  ST.selectedAccount = null;
  ST.fm = {callerType:(CALLER_TYPES[ST.template][0]||{}).key, category:null, priority:'medium', notes:'', fields:{}, track:false};
  document.getElementById('notes').value='';
  renderAll();
}

/* -------- SUBMIT ENTRY -------- */
async function submitEntry(){
  if(!ST.dispatcher){ toast('No dispatcher on duty','warn'); return; }
  if(!ST.fm.callerType){ toast('Pick a caller type','info'); return; }
  if(!ST.fm.category){ toast('Pick a category','info'); return; }
  if(ST.fm.category === 'Take a Message' && !ST.fm.fields.notifyTarget){
    toast('Select who to notify','warn'); return;
  }
  ST.fm.notes = document.getElementById('notes').value.trim();
  if(ST.template==='phone' && !ST.fm.fields.callerName){
    toast('Caller name helps — but logging anyway','info');
  }
  try{
    const result = await apiPost('/api/entries',{
      template:    ST.template,
      callerType:  ST.fm.callerType,
      fields:      {...ST.fm.fields},
      category:    ST.fm.category,
      priority:    ST.fm.priority,
      notes:       ST.fm.notes,
      dispatcher:  ST.dispatcher,
      is_incident: ST.fm.track,
      account_id:  ST.selectedAccount ? ST.selectedAccount.id : null,
    });
    hydrateEntry(result.entry);
    ST.entries.unshift(result.entry);
    if(result.incident){
      hydrateIncident(result.incident);
      ST.incidents.unshift(result.incident);
      ST.expanded.add(result.incident.id);
    }
    const routes = result.recipients||[];
    if(routes.length){
      toast(`Logged · Notifying ${routes.length} recipient${routes.length>1?'s':''}`, 'ok',
        `${routes.slice(0,3).map(r=>r.replace(/\s*\(.*\)/,'')).join(', ')}${routes.length>3?', …':''}`);
    } else {
      toast('Entry logged','ok');
    }
    resetForm();
    renderBoard(); renderLog(); renderStats(); renderQueue();
  }catch(e){
    toast('Failed to log entry','danger', e.message);
  }
}

/* -------- INCIDENT THREAD ACTIONS -------- */
function toggleExpand(id){
  if(ST.expanded.has(id)) ST.expanded.delete(id);
  else ST.expanded.add(id);
  ST.addingUpdateTo = null;
  renderBoard();
}

function startAddUpdate(id){
  ST.addingUpdateTo = id;
  ST.expanded.add(id);
  renderBoard();
  setTimeout(()=>document.getElementById('upd-text-'+id)?.focus(),20);
}
function cancelAddUpdate(){ ST.addingUpdateTo=null; renderBoard(); }

async function submitUpdate(id){
  const txtEl = document.getElementById('upd-text-'+id);
  const stEl  = document.getElementById('upd-status-'+id);
  const text  = (txtEl?.value||'').trim();
  const newSt = stEl?.value;
  if(!text && newSt==='__'){ toast('Add a note or change status','info'); return; }
  const inc = ST.incidents.find(i=>i.id===id);
  if(!inc) return;
  const statusChange = newSt && newSt!=='__' && newSt!==inc.status ? newSt : undefined;
  const kind = statusChange==='resolved'?'resolve':(statusChange==='callback'?'callback':statusChange?'status':'update');
  try{
    const result = await apiPost(`/api/incidents/${id}/thread`,{
      who:    ST.dispatcher,
      kind,
      action: statusChange ? 'changed status to '+STATUS[statusChange].label : undefined,
      body:   text,
      status: statusChange,
    });
    hydrateIncident(result.incident);
    ST.incidents = ST.incidents.map(i=>i.id===id ? result.incident : i);
    if(result.logEntry){ hydrateEntry(result.logEntry); ST.entries.unshift(result.logEntry); }
    ST.addingUpdateTo = null;
    renderBoard(); renderLog(); renderStats(); renderQueue();
    toast('Update added to '+fmtIncId(id),'ok');
  }catch(e){
    toast('Update failed','danger',e.message);
  }
}

async function quickStatus(id, newSt){
  const inc = ST.incidents.find(i=>i.id===id);
  if(!inc) return;
  if(inc.status===newSt) return;
  const kind = newSt==='resolved'?'resolve':(newSt==='callback'?'callback':'status');
  try{
    const result = await apiPost(`/api/incidents/${id}/thread`,{
      who:    ST.dispatcher,
      kind,
      action: 'changed status to '+STATUS[newSt].label,
      body:   '',
      status: newSt,
    });
    hydrateIncident(result.incident);
    ST.incidents = ST.incidents.map(i=>i.id===id ? result.incident : i);
    if(result.logEntry){ hydrateEntry(result.logEntry); ST.entries.unshift(result.logEntry); }
    renderBoard(); renderLog(); renderStats(); renderQueue();
    toast(`${fmtIncId(id)} → ${STATUS[newSt].label}`,'ok');
  }catch(e){
    toast('Status change failed','danger',e.message);
  }
}

/* -------- RENDER: INCIDENT BOARD -------- */
function activeIncidents(){
  return ST.incidents.filter(i=>i.status!=='resolved').sort((a,b)=>{
    const pri = {critical:0,high:1,medium:2,low:3};
    if(pri[a.priority]!==pri[b.priority]) return pri[a.priority]-pri[b.priority];
    return new Date(b.openedAt) - new Date(a.openedAt);
  });
}

function renderQueue(){
  const active = activeIncidents();
  const now = Date.now();
  const callbacks = active.filter(i=>i.status==='callback').length;
  const updates   = active.filter(i=>i.status==='update').length;
  const urgent    = active.filter(i=>i.priority==='critical' || i.priority==='high').length;
  const newOnes   = active.filter(i=>i.status==='new').length;

  document.getElementById('queue-row').innerHTML = [
    urgent    ? `<span class="q-chip urgent"><i data-lucide="alert-octagon" class="ic-sm"></i>Urgent <span class="qn">${urgent}</span></span>` : '',
    callbacks ? `<span class="q-chip callback"><i data-lucide="phone-incoming" class="ic-sm"></i>Pending callback <span class="qn">${callbacks}</span></span>` : '',
    updates   ? `<span class="q-chip update"><i data-lucide="clock" class="ic-sm"></i>Awaiting update <span class="qn">${updates}</span></span>` : '',
    newOnes   ? `<span class="q-chip unassigned"><i data-lucide="circle" class="ic-sm"></i>New <span class="qn">${newOnes}</span></span>` : ''
  ].join('');
  refreshIcons();
}

function renderBoard(){
  const list = activeIncidents();
  document.getElementById('inc-count').textContent = list.length ? `· ${list.length} open` : '· all clear';

  const el = document.getElementById('board');
  if(!list.length){
    el.innerHTML = `<div class="board-empty">
      <i data-lucide="shield-check"></i>
      <div class="board-empty-title">All clear</div>
      <div style="font-size:13px;">No active incidents on this shift. Routine entries below.</div>
    </div>`;
    refreshIcons();
    return;
  }

  // Action Required banner
  const now = Date.now();
  const unacked = list.filter(i=>i.status==='new' && Math.floor((now-i.openedAt.getTime())/60000)>2);
  const overdueCallbacks = list.filter(i=>i.status==='callback' && Math.floor((now-i.openedAt.getTime())/60000)>45);
  const bannerParts = [];
  if(unacked.length) bannerParts.push(`${unacked.length} incident${unacked.length>1?'s':''} unacknowledged`);
  if(overdueCallbacks.length) bannerParts.push(`${overdueCallbacks.length} callback${overdueCallbacks.length>1?'s':''} overdue`);
  const bannerHtml = bannerParts.length
    ? `<div class="action-banner"><i data-lucide="alert-circle" class="ic"></i> <strong>Action Required:</strong> ${bannerParts.join(' · ')}</div>`
    : '';

  // Swim lanes
  const urgent      = list.filter(i=>i.priority==='critical'||i.priority==='high');
  const needsAction = list.filter(i=>i.priority!=='critical'&&i.priority!=='high'&&['new','callback','update'].includes(i.status));
  const monitoring  = list.filter(i=>i.priority!=='critical'&&i.priority!=='high'&&!['new','callback','update'].includes(i.status));

  function lane(title, icon, items, cls){
    if(!items.length) return '';
    return `<div class="swim-lane ${cls}">
      <div class="swim-head" onclick="this.parentElement.classList.toggle('collapsed')">
        <span><i data-lucide="${icon}" class="ic"></i> ${title}</span>
        <span class="swim-count">${items.length}</span>
      </div>
      <div class="swim-body">${items.map(inc=>renderIncidentCard(inc)).join('')}</div>
    </div>`;
  }

  el.innerHTML = bannerHtml
    + lane('Urgent', 'alert-octagon', urgent, 'lane-urgent')
    + lane('Action Required', 'clock', needsAction, 'lane-action')
    + lane('Monitoring', 'eye', monitoring, 'lane-monitor');
  refreshIcons();
}

function renderIncidentCard(inc){
  const expanded = ST.expanded.has(inc.id);
  const last = inc.thread[inc.thread.length-1];
  const elapsedMin = Math.floor((Date.now() - inc.openedAt.getTime())/60000);
  const overdue =
    (inc.status==='new'      && elapsedMin>5) ||
    (inc.status==='update'   && elapsedMin>30) ||
    (inc.status==='callback' && elapsedMin>45) ||
    (inc.priority==='critical' && inc.status!=='resolved' && elapsedMin>10);

  const routes = computeRoutes(inc);
  const ct = CALLER_TYPES.phone.find(c=>c.key===inc.callerType) || CALLER_TYPES.guard.find(c=>c.key===inc.callerType);
  const ctIcon = ct?.icon || 'user';

  const isAdding = ST.addingUpdateTo === inc.id;
  const overdueCritical = elapsedMin > 10 && inc.status !== 'resolved';
  const needsActionBadge = inc.status === 'new' && elapsedMin > 2;
  const accountName = inc.account
    || (inc.account_id ? ST.accounts.find(a=>a.id===inc.account_id)?.name : null)
    || '';

  return `<div class="inc pri-${inc.priority}${overdueCritical?' inc-overdue-alert':''}" data-inc-id="${inc.id}">
    <div class="inc-top" onclick="toggleExpand(${inc.id})">
      <div class="inc-id">${fmtIncId(inc.id)}</div>
      <div class="inc-main">
        <div class="inc-line1">
          <span class="inc-title">${esc(accountName || inc.title)}</span>
          <span class="pri-pill ${inc.priority}"><span class="dot"></span>${PRIORITIES.find(p=>p.key===inc.priority).label}</span>
          <span class="st ${STATUS[inc.status].color}"><span class="dot"></span>${STATUS[inc.status].label}</span>
          ${needsActionBadge?`<span class="needs-action-badge"><i data-lucide="bell-ring" class="ic" style="width:10px;height:10px;"></i> Needs Action</span>`:''}
        </div>
        <div class="inc-line2">
          <span class="inc-meta-item"><i data-lucide="${ctIcon}"></i>${esc(inc.category)}</span>
          ${inc.guardName?`<span class="sep">·</span><span class="inc-meta-item"><i data-lucide="shield"></i><strong style="color:var(--n800);">${esc(inc.guardName)}</strong></span>`:''}
          ${inc.callerName?`<span class="sep">·</span><span class="inc-meta-item"><i data-lucide="user"></i><strong style="color:var(--n800);">${esc(inc.callerName)}</strong></span>`:''}
          ${inc.site?`<span class="sep">·</span><span class="inc-meta-item"><i data-lucide="map-pin"></i>${esc(inc.site)}</span>`:''}
          ${inc.unit?`<span class="sep">·</span><span class="inc-meta-item"><i data-lucide="radio"></i>${esc(inc.unit)}</span>`:''}
          ${inc.callback?`<span class="sep">·</span><span class="inc-meta-item"><i data-lucide="phone"></i><span style="font-family:var(--f-m);">${esc(inc.callback)}</span></span>`:''}
        </div>
        ${routes.length?`<div style="margin-top:5px;"><span class="inc-route"><i data-lucide="bell"></i>Notified: ${routes.map(r=>r.replace(/\s*\(.*\)/,'')).join(' · ')}</span></div>`:''}
      </div>
      <div class="inc-right">
        <span class="inc-time ${overdue?'overdue':''}"><i data-lucide="clock"></i>${fmtElapsed(inc.openedAt)}</span>
        <span style="font-size:10px;color:var(--n400);letter-spacing:.04em;">${inc.thread.length} update${inc.thread.length>1?'s':''}</span>
        <span style="font-size:10px;color:var(--n400);">${expanded?'▾':'▸'} ${expanded?'collapse':'expand'}</span>
      </div>
    </div>
    ${!expanded && last ? `<div class="inc-last">
      <span class="lu-meta">${fmtElapsed(last.ts)} · ${esc(last.who||'')}</span>
      <span class="lu-txt">${esc(last.body || last.action || '')}</span>
    </div>` : ''}
    ${expanded ? renderThread(inc, isAdding) : ''}
  </div>`;
}

function renderThread(inc, isAdding){
  const tl = inc.thread.slice().reverse().map(t=>{
    const kindClass = {create:'ev-create',status:'ev-status',update:'ev-update',resolve:'ev-resolve',callback:'ev-callback',handoff:'ev-handoff'}[t.kind] || 'ev-update';
    return `<div class="tl ${kindClass}">
      <div class="tl-head">
        <span class="tl-time">${fmtFullTime(t.ts)}</span>
        <span class="tl-who">${esc(t.who||'')}</span>
        ${t.action?`<span class="tl-action">${esc(t.action)}</span>`:''}
      </div>
      ${t.body?`<div class="tl-body">${esc(t.body)}</div>`:''}
    </div>`;
  }).join('');

  const statusOptions = Object.entries(STATUS).map(([k,v])=>
    `<option value="${k}" ${inc.status===k?'selected':''}>${v.label}</option>`
  ).join('');

  const updateForm = isAdding ? `
    <div class="update-form">
      <textarea class="inp" id="upd-text-${inc.id}" placeholder="Add an update — what happened, callbacks, who you contacted…"></textarea>
      <div class="update-form-row">
        <label style="font-size:11px;color:var(--n500);font-weight:600;letter-spacing:.06em;text-transform:uppercase;">Status:</label>
        <select id="upd-status-${inc.id}">
          <option value="__">— keep ${STATUS[inc.status].label} —</option>
          ${Object.entries(STATUS).filter(([k])=>k!==inc.status).map(([k,v])=>`<option value="${k}">→ ${v.label}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn btn-ghost" type="button" onclick="cancelAddUpdate()">Cancel</button>
        <button class="btn btn-primary" type="button" onclick="submitUpdate(${inc.id})"><i data-lucide="send" class="ic"></i> Post</button>
      </div>
    </div>` : '';

  return `<div class="inc-thread">
    ${tl}
    <div class="thread-actions">
      ${!isAdding ? `<button class="act-btn primary" onclick="startAddUpdate(${inc.id})"><i data-lucide="message-square-plus"></i> Add Update</button>` : ''}
      ${inc.status!=='callback' && inc.status!=='resolved' ? `<button class="act-btn callback" onclick="quickStatus(${inc.id},'callback')"><i data-lucide="phone-incoming"></i> Pending Callback</button>` : ''}
      ${inc.status!=='update' && inc.status!=='resolved' ? `<button class="act-btn update-needed" onclick="quickStatus(${inc.id},'update')"><i data-lucide="hourglass"></i> Awaiting Update</button>` : ''}
      ${inc.status!=='progress' && inc.status!=='resolved' ? `<button class="act-btn" onclick="quickStatus(${inc.id},'progress')"><i data-lucide="play"></i> In Progress</button>` : ''}
      ${inc.status!=='resolved' ? `<button class="act-btn resolve" onclick="quickStatus(${inc.id},'resolved')"><i data-lucide="check-circle-2"></i> Resolve</button>` : `<button class="act-btn" onclick="quickStatus(${inc.id},'progress')"><i data-lucide="rotate-ccw"></i> Reopen</button>`}
    </div>
    ${updateForm}
  </div>`;
}

/* -------- RENDER: LOG ---------- */
function renderLogFilters(){
  const tabs = [['all','All'],['phone','Phone Calls'],['system','Dispatch Notes']];
  document.getElementById('log-tabs').innerHTML = tabs.map(([k,l])=>
    `<button class="tab ${ST.logFilter===k?'act':''}" onclick="setLogFilter('${k}')">${l}</button>`
  ).join('');
  const dts = [[1,'Today'],[7,'7d'],[30,'30d'],[365,'All']];
  document.getElementById('log-date-tabs').innerHTML = dts.map(([d,l])=>
    `<button class="tab ${ST.dateFilter===d?'act':''}" onclick="setDateFilter(${d})">${l}</button>`
  ).join('');
}
function setLogFilter(f){ ST.logFilter=f; renderLog(); }
function setDateFilter(d){ ST.dateFilter=d; renderLog(); }

function renderLog(){
  renderLogFilters();
  const search = document.getElementById('log-search').value.toLowerCase().trim();
  const cutoff = new Date(Date.now() - ST.dateFilter*24*60*60*1000);

  // Build a unified feed: entries + shift markers
  const feed = [];
  ST.entries.forEach(e=>{
    if(e.ts < cutoff) return;
    if(ST.logFilter!=='all'){
      if(ST.logFilter==='phone' && e.template!=='phone') return;
      if(ST.logFilter==='system' && e.template!=='system') return;
    }
    if(search){
      const hay = [e.fields?.guardName,e.fields?.callerName,e.fields?.site,e.fields?.unit,e.notes,e.category,e.dispatcher].filter(Boolean).join(' ').toLowerCase();
      if(!hay.includes(search)) return;
    }
    feed.push({kind:'entry', ts:e.ts, data:e});
  });
  if(!search && ST.logFilter==='all'){
    ST.shifts.forEach(s=>{
      if(s.ts < cutoff) return;
      feed.push({kind:'shift', ts:s.ts, data:s});
    });
  }
  feed.sort((a,b)=>b.ts - a.ts);

  document.getElementById('log-count').textContent = feed.filter(f=>f.kind==='entry').length+' entries';

  if(!feed.length){
    document.getElementById('log-body').innerHTML = `<div class="board-empty" style="margin:20px;"><i data-lucide="inbox"></i><div class="board-empty-title">No entries match</div></div>`;
    refreshIcons();
    return;
  }

  let html = '';
  let lastDay = '';
  for(const f of feed){
    const day = dayLabel(f.ts);
    if(day !== lastDay){
      html += `<div class="log-day">${day}</div>`;
      lastDay = day;
    }
    if(f.kind==='shift'){
      const s = f.data;
      const verbs = {start:'Shift started',handoff:'Shift handoff',end:'Shift ended'};
      html += `<div class="log-shift">
        <i data-lucide="${s.kind==='handoff'?'repeat':'log-in'}"></i>
        <div class="log-shift-text"><strong>${esc(s.name)}</strong> — ${esc(verbs[s.kind]||'shift')} ${s.note?`<span style="color:var(--n500);">· ${esc(s.note)}</span>`:''}</div>
        <span class="log-shift-time">${fmtShortTime(s.ts)}</span>
      </div>`;
    } else {
      const e = f.data;
      const ctBadgeMap = {public:'Public',client:'Client',guard:'Guard',supervisor:'Supervisor',system:'System',dispatch:'Dispatch'};
      const ctClass = (e.template==='phone')?'phone':(e.template==='system'?'system':e.callerType);
      const who = e.fields?.guardName || e.fields?.callerName || e.fields?.site || (e.template==='system'?'System':'');
      html += `<div class="log-item">
        <div class="log-time">${fmtShortTime(e.ts)}</div>
        <div class="log-content">
          <div class="log-line1">
            <span class="b b-${ctClass==='phone'?'phone':ctClass}">${e.template==='phone'?'Phone':(ctBadgeMap[e.callerType]||e.callerType)}</span>
            ${who?`<span class="log-who">${esc(who)}</span>`:''}
            <span class="log-cat">${esc(e.category)}</span>
            <span class="pri-pill ${e.priority}"><span class="dot"></span>${PRIORITIES.find(p=>p.key===e.priority).label}</span>
            ${e.incident_id?`<span class="log-inc-link" onclick="jumpToIncident(${e.incident_id})">${fmtIncId(e.incident_id)}</span>`:''}
            ${e.is_incident && e.incident_id?`<span class="b b-system" style="background:var(--b50);color:var(--b500);cursor:pointer;" onclick="jumpToIncident(${e.incident_id})">Open Incident</span>`:''}
          </div>
          ${(e.fields?.site || e.fields?.unit || e.fields?.callback)?`
            <div class="log-meta">
              ${e.fields.unit?`<span style="font-family:var(--f-m);">${esc(e.fields.unit)}</span>`:''}
              ${e.fields.unit&&e.fields.site?' · ':''}
              ${e.fields.site?esc(e.fields.site):''}
              ${e.fields.callback?` · <span style="font-family:var(--f-m);">${esc(e.fields.callback)}</span>`:''}
            </div>
          `:''}
          ${e.notes?`<div class="log-notes">${esc(e.notes)}</div>`:''}
          <div class="log-by">Logged by ${esc(e.dispatcher||'—')}</div>
        </div>
      </div>`;
    }
  }
  document.getElementById('log-body').innerHTML = html;
  refreshIcons();
}

/* -------- RENDER: STATS / HEADER ---------- */
function renderStats(){
  const active = activeIncidents();
  const urgent = active.filter(i=>i.priority==='critical'||i.priority==='high').length;
  const callbacks = active.filter(i=>i.status==='callback').length;
  const today = ST.entries.filter(e=>e.ts.toDateString()===new Date().toDateString()).length;

  document.getElementById('stats').innerHTML = `
    <div class="stat ok"><span class="dot"></span>${today} today</div>
    ${active.length?`<div class="stat"><span class="dot"></span>${active.length} active</div>`:''}
    ${urgent?`<div class="stat danger"><span class="dot"></span>${urgent} urgent</div>`:''}
    ${callbacks?`<div class="stat warn"><span class="dot"></span>${callbacks} callback</div>`:''}
  `;
}

/* -------- DISPATCHER / SHIFT ---------- */
function avi(name){
  return (name||'?').split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase();
}
function showLogin(){
  const el = document.getElementById('login-list');
  el.innerHTML = ST.dispatchers.map(d=>{
    const lastShift = ST.shifts.slice().reverse().find(s=>s.name===d);
    return `<button class="drow" onclick="loginAs(${JSON.stringify(d).replace(/"/g,'&quot;')})">
      <div class="avi">${avi(d)}</div>
      <div class="dr-name">${esc(d)}</div>
      <div class="dr-meta">${lastShift?'Last on '+fmtShortDateTime(lastShift.ts):'New'}</div>
    </button>`;
  }).join('') || `<div style="color:var(--n500);font-size:13px;padding:10px 0;">No dispatchers — add one below.</div>`;
  document.getElementById('m-login').classList.remove('hidden');
}
async function loginAs(name){
  ST.dispatcher = name;
  sessionStorage.setItem(SESSION_KEY, name);
  try{
    const shift = await apiPost('/api/shifts',{dispatcher:name, kind:'start', note:''});
    hydrateShift(shift);
    ST.shifts.unshift(shift);
  }catch(e){ console.warn('shift log failed:', e.message); }
  document.getElementById('m-login').classList.add('hidden');
  document.getElementById('duty-name').textContent = name;
  document.getElementById('duty-avi').textContent = avi(name);
  toast('Shift started','ok','Welcome, '+name);
  renderAll();
}
async function addAndLogin(){
  const inp = document.getElementById('login-add-input');
  const name = inp.value.trim(); if(!name) return;
  try{
    await apiPost('/api/dispatchers',{name});
    if(!ST.dispatchers.includes(name)){ ST.dispatchers.push(name); ST.dispatchers.sort(); }
  }catch(e){ console.warn('add dispatcher failed:', e.message); }
  inp.value='';
  loginAs(name);
}

/* -------- HANDOFF ---------- */
function openHandoff(){
  // Build briefing
  const active = activeIncidents();
  const callbacks = active.filter(i=>i.status==='callback');
  const updates = active.filter(i=>i.status==='update');
  const urgent  = active.filter(i=>i.priority==='critical'||i.priority==='high');

  // Recent activity since handoff/shift start
  const lastStart = ST.shifts.find(s=>s.name===ST.dispatcher && s.kind==='start');
  const since = lastStart ? lastStart.ts : new Date(Date.now()-8*60*60*1000);
  const shiftEntries = ST.entries.filter(e=>e.ts>=since).length;

  document.getElementById('brief-from-name').textContent = ST.dispatcher||'—';

  const briefRows = (list, cls)=> list.map(i=>{
    const elapsed = Math.floor((Date.now()-i.openedAt.getTime())/60000);
    const elapsedStr = elapsed<60?elapsed+'m':Math.floor(elapsed/60)+'h '+(elapsed%60)+'m';
    return `<div class="brief-row ${cls}">
      <div>
        <div class="br-id">${fmtIncId(i.id)}</div>
      </div>
      <div>
        <div class="br-title">${esc(i.title)} <span class="pri-pill ${i.priority}" style="margin-left:4px;"><span class="dot"></span>${PRIORITIES.find(p=>p.key===i.priority).label}</span></div>
        <div class="br-sub">${esc(i.category)}${i.site?' · '+esc(i.site):''} · <span class="st ${STATUS[i.status].color}" style="font-size:9px;padding:1px 6px;"><span class="dot"></span>${STATUS[i.status].label}</span></div>
      </div>
      <div class="br-elapsed">${elapsedStr}</div>
    </div>`;
  }).join('') || `<div style="font-size:12px;color:var(--n400);padding:10px 12px;background:var(--n50);border-radius:7px;">None.</div>`;

  document.getElementById('brief-body').innerHTML = `
    <p style="font-size:13px;color:var(--n600);">The incoming dispatcher will see this full briefing. All activity, threads, and notes carry over.</p>
    <div class="brief-grid">
      <div class="brief-card ${urgent.length?'alert':''}">
        <div class="bc-num">${urgent.length}</div>
        <div class="bc-label">Urgent open</div>
        <div class="bc-sub">Critical & High priority</div>
      </div>
      <div class="brief-card ${callbacks.length?'info':''}">
        <div class="bc-num">${callbacks.length}</div>
        <div class="bc-label">Pending callback</div>
        <div class="bc-sub">Waiting for caller</div>
      </div>
      <div class="brief-card ${updates.length?'warn':''}">
        <div class="bc-num">${updates.length}</div>
        <div class="bc-label">Awaiting update</div>
        <div class="bc-sub">Field response in flight</div>
      </div>
      <div class="brief-card">
        <div class="bc-num">${shiftEntries}</div>
        <div class="bc-label">Entries this shift</div>
        <div class="bc-sub">Since ${lastStart?fmtShortDateTime(lastStart.ts):'shift start'}</div>
      </div>
    </div>

    ${urgent.length?`<div class="brief-list">
      <div class="brief-list-title">Urgent — needs eyes on</div>
      ${briefRows(urgent,'urgent')}
    </div>`:''}
    ${callbacks.length?`<div class="brief-list">
      <div class="brief-list-title">Pending callbacks</div>
      ${briefRows(callbacks,'callback')}
    </div>`:''}
    ${updates.length?`<div class="brief-list">
      <div class="brief-list-title">Awaiting field update</div>
      ${briefRows(updates,'update')}
    </div>`:''}
    ${(!urgent.length&&!callbacks.length&&!updates.length)?`<div class="brief-list"><div class="brief-list-title">All clear</div><div style="font-size:13px;color:var(--n500);">No open items needing immediate attention. Quiet handoff.</div></div>`:''}
  `;

  const sel = document.getElementById('brief-target');
  sel.innerHTML = `<option value="">Select incoming dispatcher…</option>` +
    ST.dispatchers.filter(d=>d!==ST.dispatcher).map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');

  document.getElementById('m-handoff').classList.remove('hidden');
}
async function confirmHandoff(){
  const sel = document.getElementById('brief-target');
  const to = sel.value;
  if(!to){ toast('Select an incoming dispatcher','info'); return; }
  const from = ST.dispatcher;
  try{
    // Append handoff thread event to every active incident
    await Promise.all(activeIncidents().map(inc=>
      apiPost(`/api/incidents/${inc.id}/thread`,{
        who:from, kind:'handoff', action:'shift handoff to '+to, body:''
      })
    ));
    // Log shift end for outgoing, start for incoming
    const [endShift, startShift] = await Promise.all([
      apiPost('/api/shifts',{dispatcher:from, kind:'handoff', note:'Handed off to '+to}),
      apiPost('/api/shifts',{dispatcher:to,   kind:'start',   note:''}),
    ]);
    [endShift, startShift].forEach(s=>{ hydrateShift(s); ST.shifts.unshift(s); });
    // Reload incidents so threads are fresh
    const fresh = await fetch('/api/incidents').then(r=>r.json());
    ST.incidents = (fresh||[]).map(hydrateIncident);
  }catch(e){ console.warn('handoff error:', e.message); }
  ST.dispatcher = to;
  sessionStorage.setItem(SESSION_KEY, to);
  document.getElementById('m-handoff').classList.add('hidden');
  document.getElementById('duty-name').textContent = to;
  document.getElementById('duty-avi').textContent = avi(to);
  const openCount = activeIncidents().length;
  toast('Shift handed off','ok',`${from} → ${to}. ${openCount} open incident${openCount===1?'':'s'} carried over.`);
  renderAll();
}

/* -------- SETTINGS ---------- */
function openSettings(){
  renderRulesList();
  renderContactsList();
  renderAccountsList();
  renderRosterList();
  document.getElementById('m-settings').classList.remove('hidden');
}
function showSTab(k){
  document.querySelectorAll('.s-tab').forEach(t=>t.classList.remove('act'));
  document.querySelectorAll('.s-section').forEach(s=>s.classList.remove('act'));
  event.currentTarget.classList.add('act');
  document.getElementById('ss-'+k).classList.add('act');
}
function renderRulesList(){
  const el = document.getElementById('rules-list');
  const condLabels = {priority:'Priority',category:'Category',callerType:'Caller'};
  el.innerHTML = ST.rules.map(r=>{
    const [k,v] = r.when.split('=');
    const available = ST.contacts.map(c=>c.name).filter(n=>!r.to.includes(n));
    return `<div class="rule-row" style="grid-template-columns:160px 1fr auto;">
      <div class="rule-cond">${condLabels[k]||k} = <span style="color:var(--b500);">${esc(v)}</span></div>
      <div class="rule-tos">
        ${r.to.map(t=>`<span class="route-chip" style="padding-right:4px;"><i data-lucide="bell"></i>${esc(t.replace(/\s*\(.*\)/,''))}<button onclick="removeRuleRecipient('${r.id}',${JSON.stringify(t).replace(/"/g,'&quot;')})" title="Remove" style="background:transparent;border:none;color:var(--n400);padding:0 2px;margin-left:2px;border-radius:3px;cursor:pointer;display:inline-flex;align-items:center;" onmouseover="this.style.color='var(--danger)';this.style.background='var(--danger-50)'" onmouseout="this.style.color='var(--n400)';this.style.background='transparent'"><i data-lucide="x" style="width:11px;height:11px;"></i></button></span>`).join('')}
        ${available.length?`<select onchange="addRuleRecipient('${r.id}',this.value);this.value='';" style="padding:3px 6px;border-radius:14px;border:1px dashed var(--b300);background:#fff;font-size:11px;font-weight:600;color:var(--b500);cursor:pointer;">
          <option value="">+ Add recipient…</option>
          ${available.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}
        </select>`:''}
      </div>
      <button class="rule-x" onclick="removeRule('${r.id}')" title="Remove entire rule"><i data-lucide="trash-2"></i></button>
    </div>`;
  }).join('');

  // New-rule builder
  el.innerHTML += `<div class="rule-row" style="grid-template-columns:160px 1fr auto;background:#fff;border:1.5px dashed var(--b200);margin-top:8px;">
    <div style="display:flex;gap:4px;align-items:center;">
      <select id="nr-key" style="flex:1;padding:5px 6px;border-radius:5px;border:1px solid var(--n200);font-size:12px;font-weight:600;" onchange="renderNewRuleValues()">
        <option value="priority">Priority</option>
        <option value="category">Category</option>
        <option value="callerType">Caller</option>
      </select>
      <span style="font-weight:700;color:var(--n400);">=</span>
      <select id="nr-val" style="flex:1.4;padding:5px 6px;border-radius:5px;border:1px solid var(--n200);font-size:12px;"></select>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <select id="nr-to" style="padding:5px 8px;border-radius:5px;border:1px solid var(--n200);font-size:12px;flex:1;">
        <option value="">Select recipient…</option>
        ${ST.contacts.map(c=>`<option value="${esc(c.name)}">${esc(c.name)} · ${esc(c.role)}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;" onclick="addNewRule()"><i data-lucide="plus" class="ic"></i> Add Rule</button>
  </div>`;
  renderNewRuleValues();
  refreshIcons();
}

const RULE_VALUE_OPTIONS = {
  priority: ['critical','high','medium','low'],
  category: ['No Call / No Show','Post Abandoned','Late to Post','Patrol Check-in','Post Check','Incident Report','Alarm','Client Inquiry','Complaint','Vehicle / Accident','Scheduling','Maintenance','Equipment Issue','HR Issue','eHub Issues','Time Off Request','Disciplinary Action','Uniform Return','Additional Service Request','Activity Audit','Take a Message','Callout'],
  callerType:['public','client','guard','supervisor','system']
};
function renderNewRuleValues(){
  const k = document.getElementById('nr-key').value;
  const sel = document.getElementById('nr-val');
  sel.innerHTML = RULE_VALUE_OPTIONS[k].map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function removeRuleRecipient(ruleId, name){
  const r = ST.rules.find(x=>x.id===ruleId); if(!r) return;
  r.to = r.to.filter(t=>t!==name);
  if(r.to.length===0){
    ST.rules = ST.rules.filter(x=>x.id!==ruleId);
    toast('Rule removed (no recipients left)','warn');
  } else {
    toast(`Removed ${name.replace(/\s*\(.*\)/,'')}`,'ok');
  }
  renderRulesList();
}
function addRuleRecipient(ruleId, name){
  if(!name) return;
  const r = ST.rules.find(x=>x.id===ruleId); if(!r) return;
  if(!r.to.includes(name)) r.to.push(name);
  toast(`Added ${name.replace(/\s*\(.*\)/,'')}`,'ok');
  renderRulesList();
}
function addNewRule(){
  const k = document.getElementById('nr-key').value;
  const v = document.getElementById('nr-val').value;
  const to = document.getElementById('nr-to').value;
  if(!to){ toast('Pick a recipient','info'); return; }
  // Merge into existing rule with same condition if exists
  const existing = ST.rules.find(r=>r.when===k+'='+v);
  if(existing){
    if(!existing.to.includes(to)) existing.to.push(to);
    toast('Added to existing rule','ok');
  } else {
    ST.rules.push({id:'r'+Date.now(), when:k+'='+v, to:[to]});
    toast('Rule added','ok');
  }
  renderRulesList();
}
function removeRule(id){
  ST.rules = ST.rules.filter(r=>r.id!==id);
  renderRulesList();
  toast('Rule removed','ok');
}
function renderContactsList(){
  const el = document.getElementById('contacts-list');
  el.innerHTML = ST.contacts.map((c,i)=>`<div class="contact-row">
    <div><div class="contact-name">${esc(c.name)}</div><div class="contact-meta">${esc(c.email)}</div></div>
    <div style="font-size:12px;color:var(--n500);">${esc(c.role)}</div>
    <button class="rule-x" onclick="removeContact(${i})"><i data-lucide="trash-2"></i></button>
  </div>`).join('') || `<div style="color:var(--n500);font-size:12px;">No contacts.</div>`;
  refreshIcons();
}
function addContact(){
  const name  = document.getElementById('ct-name').value.trim();
  const role  = document.getElementById('ct-role').value.trim();
  const email = document.getElementById('ct-email').value.trim();
  if(!name) return;
  ST.contacts.push({name, role, email});
  document.getElementById('ct-name').value='';
  document.getElementById('ct-role').value='';
  document.getElementById('ct-email').value='';
  renderContactsList();
}
function removeContact(i){
  ST.contacts.splice(i,1);
  renderContactsList();
}

/* -------- ACCOUNTS SETTINGS -------- */
function renderAccountsList(){
  const el = document.getElementById('accounts-list');
  if(!el) return;
  el.innerHTML = ST.accounts.map(a=>`
    <div class="contact-row" style="align-items:flex-start;">
      <div style="flex:1;min-width:0;">
        <div class="contact-name">${esc(a.name)}${a.accountNumber?` <span style="font-weight:400;color:var(--n500);">#${esc(a.accountNumber)}</span>`:''}</div>
        ${a.site?`<div class="contact-meta">${esc(a.site)}</div>`:''}
        ${a.clientContact?`<div class="contact-meta">${esc(a.clientContact)}${a.clientPhone?' &middot; '+esc(a.clientPhone):''}</div>`:''}
        ${a.notes?`<div style="font-size:11px;color:var(--n400);margin-top:2px;font-style:italic;">${esc(a.notes)}</div>`:''}
      </div>
      <button class="rule-x" onclick="removeAccount(${a.id})"><i data-lucide="trash-2"></i></button>
    </div>
  `).join('') || `<div style="color:var(--n500);font-size:12px;">No accounts yet. Add one below.</div>`;
  refreshIcons();
}
async function addAccount(){
  const name    = document.getElementById('ac-name').value.trim();
  const number  = document.getElementById('ac-number').value.trim();
  const site    = document.getElementById('ac-site').value.trim();
  const contact = document.getElementById('ac-contact').value.trim();
  const email   = document.getElementById('ac-email').value.trim();
  const phone   = document.getElementById('ac-phone').value.trim();
  const notes   = document.getElementById('ac-notes').value.trim();
  if(!name){ toast('Account name is required','warn'); return; }
  try{
    const acc = await apiPost('/api/accounts',{
      name, account_number:number, site,
      client_contact:contact, client_email:email,
      client_phone:phone, notes
    });
    ST.accounts.push(acc);
    ST.accounts.sort((a,b)=>a.name.localeCompare(b.name));
    ['ac-name','ac-number','ac-site','ac-contact','ac-email','ac-phone','ac-notes']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    renderAccountsList();
    toast('Account added','ok');
  }catch(e){
    toast('Failed to add account','danger',e.message);
  }
}
async function removeAccount(id){
  try{
    await apiDelete(`/api/accounts/${id}`);
    ST.accounts = ST.accounts.filter(a=>a.id!==id);
    if(ST.selectedAccount && ST.selectedAccount.id===id) ST.selectedAccount=null;
    renderAccountsList();
    toast('Account removed','ok');
  }catch(e){
    toast('Failed to remove account','danger',e.message);
  }
}
function renderRosterList(){
  const el = document.getElementById('roster-list');
  el.innerHTML = ST.dispatchers.map(d=>`<div class="contact-row">
    <div class="contact-name">${esc(d)}${d===ST.dispatcher?' <span class="b b-system" style="background:var(--ok-50);color:var(--ok-700);">On duty</span>':''}</div>
    <div></div>
    <button class="rule-x" onclick="removeDispatcher(${JSON.stringify(d).replace(/"/g,'&quot;')})"><i data-lucide="trash-2"></i></button>
  </div>`).join('');
  refreshIcons();
}
async function addDispatcherSetting(){
  const inp = document.getElementById('ds-input');
  const n = inp.value.trim(); if(!n) return;
  try{
    await apiPost('/api/dispatchers',{name:n});
    if(!ST.dispatchers.includes(n)){ ST.dispatchers.push(n); ST.dispatchers.sort(); }
  }catch(e){ toast('Add failed','danger',e.message); return; }
  inp.value=''; renderRosterList();
}
async function removeDispatcher(d){
  if(d===ST.dispatcher){ toast("Can't remove the on-duty dispatcher",'warn'); return; }
  try{
    await apiDelete(`/api/dispatchers/${encodeURIComponent(d)}`);
    ST.dispatchers = ST.dispatchers.filter(x=>x!==d);
  }catch(e){ toast('Remove failed','danger',e.message); return; }
  renderRosterList();
}
async function saveSettings(){
  try{
    const result = await apiPost('/api/settings',{rules:ST.rules, contacts:ST.contacts});
    ST.rules    = result.rules;
    ST.contacts = result.contacts;
    closeModal('m-settings');
    toast('Settings saved','ok');
  }catch(e){
    toast('Save failed','danger',e.message);
  }
}

/* -------- EXPORT ---------- */
function exportCSV(){
  if(!ST.entries.length){ toast('No entries to export','info'); return; }
  const cols=['ID','Timestamp','Template','Caller','Who','Unit','Site','Callback','Category','Priority','Notes','Incident','Dispatcher'];
  const rows = ST.entries.map(e=>[
    fmtEntId(e.id), e.ts.toLocaleString(), e.template, e.callerType,
    e.fields?.guardName||e.fields?.callerName||'',
    e.fields?.unit||'', e.fields?.site||'', e.fields?.callback||'',
    e.category, e.priority,
    (e.notes||'').replace(/[\r\n,"]/g,' '),
    e.incident_id?fmtIncId(e.incident_id):'',
    e.dispatcher||''
  ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [cols.join(','),...rows].join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='fpi-dispatch-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  toast('CSV exported','ok');
}

/* -------- TOAST ---------- */
let toastId=0;
function toast(title, type='info', msg=''){
  toastId++;
  const id='toast-'+toastId;
  const ic = {ok:'check-circle-2',warn:'alert-triangle',danger:'alert-octagon',info:'info'}[type] || 'info';
  const el = document.createElement('div');
  el.className = 'toast '+type;
  el.id = id;
  el.innerHTML = `<div class="toast-ic"><i data-lucide="${ic}"></i></div>
    <div class="toast-body"><div class="toast-title">${esc(title)}</div>${msg?`<div class="toast-msg">${esc(msg)}</div>`:''}</div>
    <button class="toast-x" onclick="document.getElementById('${id}').remove()">×</button>`;
  document.getElementById('toasts').appendChild(el);
  refreshIcons();
  setTimeout(()=>{
    const e = document.getElementById(id);
    if(e){ e.style.transition='opacity .25s'; e.style.opacity='0'; setTimeout(()=>e.remove(),250); }
  }, type==='ok'?4500:6500);
}

function closeModal(id){ document.getElementById(id).classList.add('hidden'); }

/* -------- UTILITIES ---------- */
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtShortTime(d){
  return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase();
}
function fmtFullTime(d){
  return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase();
}
function fmtShortDateTime(d){
  return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
}
function dayLabel(d){
  const today = new Date(); today.setHours(0,0,0,0);
  const cmp = new Date(d); cmp.setHours(0,0,0,0);
  const diff = Math.round((today - cmp)/(24*60*60*1000));
  if(diff===0) return 'Today · ' + d.toLocaleDateString('en-US',{weekday:'long', month:'short', day:'numeric'});
  if(diff===1) return 'Yesterday · ' + d.toLocaleDateString('en-US',{month:'short', day:'numeric'});
  return d.toLocaleDateString('en-US',{weekday:'short', month:'short', day:'numeric'});
}
function fmtElapsed(d){
  const m = Math.floor((Date.now() - d.getTime())/60000);
  if(m<1) return 'just now';
  if(m<60) return m+'m ago';
  const h = Math.floor(m/60), mm = m%60;
  if(h<24) return mm?`${h}h ${mm}m`:`${h}h`;
  const dys = Math.floor(h/24);
  return dys+'d ago';
}

function refreshIcons(){
  if(window.lucide) lucide.createIcons();
}

async function jumpToIncident(id){
  const inc = ST.incidents.find(i=>i.id===id);
  if(inc){
    ST.expanded.add(id);
    renderBoard();
    setTimeout(()=>{
      const el = document.querySelector(`[data-inc-id="${id}"]`);
      if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
    }, 60);
    return;
  }
  // Incident not on active board — fetch it (may be resolved) and show in modal
  try{
    const data = await fetch(`/api/incidents/${id}`).then(r=>{ if(!r.ok) throw new Error(r.statusText); return r.json(); });
    hydrateIncident(data);
    showIncidentModal(data);
  }catch(e){
    toast(`Could not load ${fmtIncId(id)}`,'danger',e.message);
  }
}

function showIncidentModal(inc){
  const statusLabel = STATUS[inc.status]?.label || inc.status;
  const resolvedStr = inc.resolvedAt ? ' · Resolved '+fmtShortDateTime(inc.resolvedAt) : '';
  document.getElementById('m-inc-title').textContent = fmtIncId(inc.id)+' — '+inc.title;
  document.getElementById('m-inc-meta').textContent =
    inc.category+' · '+PRIORITIES.find(p=>p.key===inc.priority)?.label+' priority · '+statusLabel+resolvedStr;

  const thread = inc.thread.slice().reverse().map(t=>{
    const kindClass = {create:'ev-create',status:'ev-status',update:'ev-update',resolve:'ev-resolve',callback:'ev-callback',handoff:'ev-handoff'}[t.kind]||'ev-update';
    return `<div class="tl ${kindClass}">
      <div class="tl-head">
        <span class="tl-time">${fmtFullTime(t.ts)}</span>
        <span class="tl-who">${esc(t.who||'')}</span>
        ${t.action?`<span class="tl-action">${esc(t.action)}</span>`:''}
      </div>
      ${t.body?`<div class="tl-body">${esc(t.body)}</div>`:''}
    </div>`;
  }).join('');

  const meta = [
    inc.site    ? `<span><i data-lucide="map-pin" class="ic"></i>${esc(inc.site)}</span>` : '',
    inc.unit    ? `<span><i data-lucide="radio" class="ic"></i>${esc(inc.unit)}</span>` : '',
    inc.callback? `<span><i data-lucide="phone" class="ic"></i>${esc(inc.callback)}</span>` : '',
    inc.callerName?`<span><i data-lucide="user" class="ic"></i>${esc(inc.callerName)}</span>` : '',
    inc.guardName ?`<span><i data-lucide="shield" class="ic"></i>${esc(inc.guardName)}</span>` : '',
  ].filter(Boolean).join('');

  document.getElementById('m-inc-body').innerHTML = `
    ${meta?`<div class="inc-line2" style="margin-bottom:14px;">${meta}</div>`:''}
    <div class="inc-thread">${thread}</div>
  `;
  document.getElementById('m-incident').classList.remove('hidden');
  refreshIcons();
}

/* -------- QUICK ACTIONS BAR ---------- */
const QA_CONFIG = [
  {key:'checkin', label:'Check-in', icon:'radio',          cls:'qa-checkin'},
  {key:'callout', label:'Callout',  icon:'phone-outgoing', cls:'qa-callout'},
  {key:'ncns',    label:'NCNS',     icon:'user-x',         cls:'qa-ncns'},
  {key:'late',    label:'Late',     icon:'clock',          cls:'qa-late'},
  {key:'abandon', label:'Abandon',  icon:'alert-triangle', cls:'qa-abandon'},
  {key:'sched',   label:'Sched',    icon:'calendar',       cls:'qa-sched'},
];
function renderQABar(){
  const el = document.getElementById('qa-bar'); if(!el) return;
  el.innerHTML = QA_CONFIG.map(q=>{
    const action = QUICK_ACTIONS.find(a=>a.key===q.key);
    const active = action && ST.fm.category === action.cat && ST.template === action.tpl;
    return `
    <button type="button" class="qa-btn ${q.cls}${active?' qa-active':''}" onclick="applyQuick('${q.key}')" title="${action?.cat||q.label}">
      <i data-lucide="${q.icon}" class="ic"></i>
      <span>${q.label}</span>
    </button>`;
  }).join('');
  refreshIcons();
}

/* -------- ESCALATION PROTOCOLS ---------- */
const PROTOCOLS_KEY = 'fpi_protocols';
const DEFAULT_PROTOCOLS = [
  { category:'Medical Emergency', trigger:'critical',
    steps:['Call 911 immediately — do not wait for officer assessment',
           'Notify Field Supervisor & Ops Manager simultaneously',
           'Dispatch nearest officer to scene if not already on-site',
           'Stay on line with caller until EMS arrives; document arrival time'] },
  { category:'Post Abandoned', trigger:'critical',
    steps:['Attempt radio & phone contact — document each attempt with timestamp',
           'If no contact within 5 min → notify Field Supervisor for immediate coverage',
           'Dispatch relief officer; notify Account Manager of potential service gap',
           'Ops Manager must be notified if gap exceeds 15 min'] },
  { category:'No Call / No Show', trigger:'high',
    steps:['Call officer personal number — 3 attempts over 10 min, leave voicemail',
           'Notify Field Supervisor for coverage decision',
           'Contact Scheduling Lead — relief assignment required',
           'Notify client contact if post will be uncovered more than 30 min'] },
  { category:'Trespassing / Disturbance', trigger:'high',
    steps:['Confirm officer is safe before any escalation',
           'If physical confrontation or weapons: advise officer to disengage, call 911',
           'Add suspect description as a BOL for all field units immediately',
           'Notify Account Manager if incident is on client property'] },
  { category:'Alarm Activation', trigger:'medium',
    steps:['Dispatch nearest officer; log estimated ETA',
           'Attempt to reach client key-holder contact',
           'If no key-holder response within 15 min and officer is on-scene, advise 911',
           'Log alarm company name, reference #, and clear incident when resolved'] },
  { category:'Suspicious Activity', trigger:'medium',
    steps:['Log full description as a BOL — share with all active field units',
           'Advise officer: observe and report only, no direct engagement unless necessary',
           'If behavior escalates to threat level, authorize officer to call 911',
           'Notify client if activity is on or adjacent to their property'] }
];
let ESCALATION_PROTOCOLS = JSON.parse(localStorage.getItem(PROTOCOLS_KEY)) || DEFAULT_PROTOCOLS.map(p=>({...p, steps:[...p.steps]}));
function saveProtocols(){ localStorage.setItem(PROTOCOLS_KEY, JSON.stringify(ESCALATION_PROTOCOLS)); }

let _editingProtocol = null;
function startEditProtocol(i){ _editingProtocol=i; renderEscalationList(); }
function cancelEditProtocol(){ _editingProtocol=null; renderEscalationList(); }

function addProtocol(){
  ESCALATION_PROTOCOLS.push({category:'New Protocol', trigger:'medium', steps:['Step 1']});
  _editingProtocol = ESCALATION_PROTOCOLS.length - 1;
  saveProtocols();
  renderEscalationList();
}
function removeProtocol(i){
  ESCALATION_PROTOCOLS.splice(i,1);
  _editingProtocol=null;
  saveProtocols();
  renderEscalationList();
  toast('Protocol removed','warn');
}
function _collectSteps(i){
  return Array.from(document.querySelectorAll(`[data-step="${i}"]`)).map(el=>el.value.trim()).filter(Boolean);
}
function addStep(i){
  const steps = _collectSteps(i);
  steps.push('');
  ESCALATION_PROTOCOLS[i].steps = steps;
  renderEscalationList();
  setTimeout(()=>{ const els=document.querySelectorAll(`[data-step="${i}"]`); els[els.length-1]?.focus(); },20);
}
function removeStep(i,j){
  const steps = _collectSteps(i);
  steps.splice(j,1);
  ESCALATION_PROTOCOLS[i].steps = steps.length ? steps : [''];
  renderEscalationList();
}
function saveProtocolEdit(i){
  const cat = document.getElementById(`esc-edit-cat-${i}`)?.value.trim(); if(!cat) return;
  const trigger = document.getElementById(`esc-edit-lvl-${i}`)?.value;
  const steps = _collectSteps(i);
  ESCALATION_PROTOCOLS[i] = {category:cat, trigger, steps:steps.length?steps:['']};
  saveProtocols();
  _editingProtocol=null;
  renderEscalationList();
  toast('Protocol saved','ok');
}

/* -------- BOL / WATCH ORDERS ---------- */
const BOL_KEY = 'fpi_bols';
function saveBols(){ localStorage.setItem(BOL_KEY, JSON.stringify(ST.bols)); }

function addBol(){
  const inp = document.getElementById('bol-input');
  const text = (inp?.value||'').trim(); if(!text) return;
  ST.bols.unshift({id:Date.now(), text, ts:new Date().toISOString(), by:ST.dispatcher||'Dispatch'});
  saveBols();
  inp.value = '';
  renderBolList();
  toast('BOL added','ok','Watch order is live for this shift');
}

function clearBol(id){
  ST.bols = ST.bols.filter(b=>b.id!==id);
  saveBols();
  renderBolList();
}

function renderBolList(){
  const el = document.getElementById('bol-list'); if(!el) return;
  if(!ST.bols.length){
    el.innerHTML = '<div class="bol-empty">No active watch orders — add one above</div>';
    return;
  }
  el.innerHTML = ST.bols.map(b=>`
    <div class="bol-item">
      <div>
        <div class="bol-text">${esc(b.text)}</div>
        <div class="bol-meta">${fmtShortDateTime(new Date(b.ts))} · ${esc(b.by)}</div>
      </div>
      <button class="bol-clr" onclick="clearBol(${b.id})" title="Clear this BOL">
        <i data-lucide="x" class="ic-sm"></i>
      </button>
    </div>
  `).join('');
  refreshIcons();
}

function toggleEscCard(i){
  const el = document.getElementById('esc-body-'+i); if(!el) return;
  el.style.display = el.style.display==='none' ? '' : 'none';
}

function renderEscalationList(){
  const el = document.getElementById('esc-list'); if(!el) return;
  el.innerHTML = ESCALATION_PROTOCOLS.map((p,i)=>{
    if(_editingProtocol===i){
      return `<div class="esc-card esc-editing">
        <div class="esc-card-hd" style="background:var(--b50);cursor:default;">
          <input id="esc-edit-cat-${i}" class="inp" value="${esc(p.category)}" style="flex:1;font-size:12px;font-weight:700;padding:5px 8px;">
          <select id="esc-edit-lvl-${i}" style="padding:4px 8px;border-radius:5px;border:1px solid var(--n200);font-size:11px;font-weight:700;margin-left:8px;">
            <option value="critical" ${p.trigger==='critical'?'selected':''}>CRITICAL</option>
            <option value="high"     ${p.trigger==='high'?'selected':''}>HIGH</option>
            <option value="medium"   ${p.trigger==='medium'?'selected':''}>MEDIUM</option>
          </select>
        </div>
        <div class="esc-body">
          ${p.steps.map((s,j)=>`
            <div class="esc-step" style="align-items:center;">
              <span class="esc-num">${j+1}</span>
              <input class="inp" data-step="${i}" value="${esc(s)}" style="flex:1;font-size:12px;padding:5px 8px;">
              <button onclick="removeStep(${i},${j})" class="bol-clr" title="Remove step"><i data-lucide="x" class="ic-sm"></i></button>
            </div>`).join('')}
          <button onclick="addStep(${i})" class="btn" style="margin-top:4px;padding:5px 10px;font-size:11px;"><i data-lucide="plus" class="ic"></i> Add Step</button>
        </div>
        <div style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--n100);background:var(--n50);">
          <button onclick="saveProtocolEdit(${i})" class="btn btn-primary" style="padding:6px 12px;font-size:12px;"><i data-lucide="save" class="ic"></i> Save</button>
          <button onclick="cancelEditProtocol()" class="btn" style="padding:6px 12px;font-size:12px;">Cancel</button>
          <div style="flex:1;"></div>
          <button onclick="removeProtocol(${i})" class="btn btn-danger" style="padding:6px 10px;font-size:12px;" title="Delete protocol"><i data-lucide="trash-2" class="ic"></i></button>
        </div>
      </div>`;
    }
    return `<div class="esc-card">
      <div class="esc-card-hd" onclick="toggleEscCard(${i})">
        <span class="esc-cat">${esc(p.category)}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="esc-lvl ${p.trigger}">${p.trigger.toUpperCase()}</span>
          <button onclick="event.stopPropagation();startEditProtocol(${i})" class="bol-clr" title="Edit protocol"><i data-lucide="pencil" class="ic-sm"></i></button>
        </div>
      </div>
      <div class="esc-body" id="esc-body-${i}" style="${i===0?'':'display:none'}">
        ${p.steps.map((s,j)=>{
          const numCls=(p.trigger==='critical'&&j===p.steps.length-1)?'danger-num':(p.trigger!=='medium'&&j===1)?'warn-num':'';
          return `<div class="esc-step"><span class="esc-num ${numCls}">${j+1}</span><span>${esc(s)}</span></div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  el.innerHTML += `<button onclick="addProtocol()" class="btn" style="width:100%;justify-content:center;margin-top:4px;padding:8px;font-size:12px;border-style:dashed;"><i data-lucide="plus" class="ic"></i> Add Protocol</button>`;
  refreshIcons();
}

let _refRendered = false;
function renderReference(){
  const panel = document.getElementById('ref-panel'); if(!panel) return;
  panel.innerHTML = `
    <div>
      <div class="ref-s-head">
        <div class="ref-s-title"><i data-lucide="eye" class="ic"></i> Watch Orders / BOL</div>
        <span style="font-size:10px;color:var(--n400);">Cleared manually · shift-persistent</span>
      </div>
      <div class="bol-add">
        <input class="inp" id="bol-input" placeholder="Describe subject, vehicle, or situation to watch for…"
          onkeydown="if(event.key==='Enter'){event.preventDefault();addBol();}">
        <button class="btn btn-primary" style="padding:8px 13px;font-size:12px;white-space:nowrap;" onclick="addBol()">
          <i data-lucide="plus" class="ic"></i> Add
        </button>
      </div>
      <div id="bol-list"></div>
    </div>
    <div style="border-top:2px solid var(--n100);margin-top:4px;">
      <div class="ref-s-head">
        <div class="ref-s-title"><i data-lucide="shield-alert" class="ic"></i> Escalation Protocols</div>
        <span style="font-size:10px;color:var(--n400);">Tap a card to expand</span>
      </div>
      <div class="esc-list" id="esc-list"></div>
    </div>
    <div style="border-top:2px solid var(--n100);margin-top:4px;">
      <div class="ref-s-head">
        <div class="ref-s-title"><i data-lucide="users" class="ic"></i> Available Guards</div>
        <span style="font-size:10px;color:var(--n400);">Click status to toggle</span>
      </div>
      <div class="guard-add-form">
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="inp" id="guard-input" placeholder="Guard name…" style="flex:1;">
          <button class="btn btn-primary" style="padding:8px 13px;font-size:12px;white-space:nowrap;" onclick="addGuard()">
            <i data-lucide="plus" class="ic"></i> Add
          </button>
        </div>
        <div class="guard-add-row">
          <span class="guard-add-label">Days:</span>
          <div class="guard-day-checks">
            ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`
              <label class="guard-check-label"><input type="checkbox" class="guard-day-cb" value="${d}"><span>${d}</span></label>
            `).join('')}
          </div>
        </div>
        <div class="guard-add-row">
          <span class="guard-add-label">Shifts:</span>
          <div class="guard-day-checks">
            ${['Mornings','Afternoons','Overnights'].map(s=>`
              <label class="guard-check-label"><input type="checkbox" class="guard-shift-cb" value="${s}"><span>${s}</span></label>
            `).join('')}
          </div>
        </div>
      </div>
      <div id="guards-list"></div>
    </div>
  `;
  refreshIcons();
  renderBolList();
  renderEscalationList();
  loadGuards().then(renderGuardsList);
}

/* -------- AVAILABLE GUARDS ---------- */
async function loadGuards(){
  try {
    const r = await fetch('/api/guards');
    if(r.ok) ST.guards = await r.json();
  } catch(e){ console.error('loadGuards:', e); }
}

async function addGuard(){
  const inp = document.getElementById('guard-input');
  const name = (inp?.value||'').trim(); if(!name) return;
  const days = [...document.querySelectorAll('.guard-day-cb:checked')].map(c=>c.value);
  const shifts = [...document.querySelectorAll('.guard-shift-cb:checked')].map(c=>c.value);
  try {
    const r = await fetch('/api/guards', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name, status:'available', days, shifts})
    });
    if(r.ok){ ST.guards.push(await r.json()); }
  } catch(e){ console.error('addGuard:', e); }
  inp.value='';
  document.querySelectorAll('.guard-day-cb,.guard-shift-cb').forEach(c=>c.checked=false);
  renderGuardsList();
}

async function removeGuard(id){
  try {
    await fetch(`/api/guards/${id}`, {method:'DELETE'});
    ST.guards = ST.guards.filter(g=>g.id!==id);
  } catch(e){ console.error('removeGuard:', e); }
  renderGuardsList();
}

async function toggleGuardStatus(id){
  const g = ST.guards.find(x=>x.id===id); if(!g) return;
  const newStatus = g.status==='available' ? 'busy' : 'available';
  try {
    const r = await fetch(`/api/guards/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({status: newStatus})
    });
    if(r.ok) g.status = newStatus;
  } catch(e){ console.error('toggleGuardStatus:', e); }
  renderGuardsList();
}

function renderGuardsList(){
  const el = document.getElementById('guards-list'); if(!el) return;
  if(!ST.guards.length){
    el.innerHTML = '<div class="bol-empty">No guards listed — add one above</div>';
    return;
  }
  const avail = ST.guards.filter(g=>g.status==='available').length;
  el.innerHTML = `<div style="padding:6px 18px;font-size:10px;color:var(--n500);letter-spacing:.06em;">${avail} of ${ST.guards.length} available</div>`
    + ST.guards.map(g=>{
      const hasSched = (g.days?.length||0) + (g.shifts?.length||0) > 0;
      return `
    <div class="guard-item">
      <div class="guard-item-main">
        <div class="guard-item-top">
          <button class="guard-status ${g.status}" onclick="toggleGuardStatus(${g.id})" title="Click to toggle">
            <span class="guard-dot"></span>${g.status==='available'?'Available':'Busy'}
          </button>
          <span class="guard-name">${esc(g.name)}</span>
          <button class="bol-clr" onclick="removeGuard(${g.id})" title="Remove"><i data-lucide="x" class="ic-sm"></i></button>
        </div>
        ${hasSched ? `<div class="guard-avail">
          ${g.days?.length ? `<span class="guard-avail-group"><i data-lucide="calendar" class="ic-sm"></i>${g.days.map(d=>`<span class="guard-chip">${d}</span>`).join('')}</span>` : ''}
          ${g.shifts?.length ? `<span class="guard-avail-group"><i data-lucide="clock" class="ic-sm"></i>${g.shifts.map(s=>`<span class="guard-chip shift">${s}</span>`).join('')}</span>` : ''}
        </div>` : ''}
      </div>
    </div>`;
    }).join('');
  refreshIcons();
}

/* -------- RIGHT TAB SWITCHER ---------- */
function setRightTab(tab){
  const logView = document.getElementById('right-log-view');
  const refView = document.getElementById('right-ref-view');
  const csvBtn  = document.getElementById('csv-btn');
  document.getElementById('rt-log').classList.toggle('act', tab==='log');
  document.getElementById('rt-ref').classList.toggle('act', tab==='ref');
  if(tab==='log'){
    logView.style.display='flex';
    refView.style.display='none';
    if(csvBtn) csvBtn.style.display='';
  } else {
    logView.style.display='none';
    refView.style.display='flex';
    if(csvBtn) csvBtn.style.display='none';
    if(!_refRendered){ renderReference(); _refRendered=true; }
    else { renderBolList(); loadGuards().then(renderGuardsList); }
  }
}

/* -------- CLOCK ---------- */
function tickClock(){
  const d = new Date();
  document.getElementById('clk').textContent =
    d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  document.getElementById('clk-date').textContent =
    d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

/* -------- LIFECYCLE ---------- */
function renderAll(){
  renderQABar();
  renderTemplateTabs();
  renderCallerRow();
  renderDynFields();
  renderCatGrid();
  renderPriRow();
  renderRouting();
  renderTrackRow();
  renderBoard();
  renderLog();
  renderStats();
  renderQueue();
}

async function bootstrap(){
  tickClock(); setInterval(tickClock, 1000);

  // Show loading state while fetching
  document.getElementById('board').innerHTML =
    '<div class="board-empty"><i data-lucide="loader"></i><div class="board-empty-title">Loading…</div></div>';
  refreshIcons();

  await loadState();

  // Set defaults
  ST.fm.callerType = CALLER_TYPES[ST.template][0].key;

  // Auto-tick all elapsed times every 30s
  setInterval(()=>{
    // Preserve any in-progress update form text before the DOM is rebuilt
    let savedText = null, savedStatus = null;
    if(ST.addingUpdateTo !== null){
      const txtEl = document.getElementById('upd-text-'+ST.addingUpdateTo);
      const stEl  = document.getElementById('upd-status-'+ST.addingUpdateTo);
      savedText   = txtEl?.value ?? null;
      savedStatus = stEl?.value  ?? null;
    }
    renderBoard(); renderStats(); renderQueue();
    if(ST.addingUpdateTo !== null && savedText !== null){
      const txtEl = document.getElementById('upd-text-'+ST.addingUpdateTo);
      const stEl  = document.getElementById('upd-status-'+ST.addingUpdateTo);
      if(txtEl) txtEl.value = savedText;
      if(stEl && savedStatus !== null) stEl.value = savedStatus;
    }
  }, 30000);

  if(!ST.dispatcher){
    showLogin();
  } else {
    document.getElementById('m-login').classList.add('hidden');
    document.getElementById('duty-name').textContent = ST.dispatcher;
    document.getElementById('duty-avi').textContent = avi(ST.dispatcher);
  }
  renderAll();
  refreshIcons();

  // Keyboard shortcuts
  document.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey) && e.key==='Enter'){ e.preventDefault(); submitEntry(); }
    if(e.key==='Escape'){
      ['m-handoff','m-settings'].forEach(id=>closeModal(id));
      ST.addingUpdateTo = null; renderBoard();
    }
  });

  // Click scrim to close
  ['m-handoff','m-settings','m-incident'].forEach(id=>{
    document.getElementById(id).addEventListener('click',function(e){
      if(e.target===this) closeModal(id);
    });
  });
}

document.addEventListener('DOMContentLoaded', ()=>bootstrap());
