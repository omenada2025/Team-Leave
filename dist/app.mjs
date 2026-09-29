import {
  people, minimumCoverage, holidays, holidayName, iso, parseDate, addBusinessDays, addDays,
  businessDays, requestDuration, balanceDuration, setTeam, setHolidays, remaining, coverageFor,
  validateRequest, managesPerson, ontarioHolidays, activePeople
} from './logic.mjs';
import {
  appRedirectUrl, parseAuthUrl, scrubAuthParamsFromUrl, markRecoveryIntent,
  clearRecoveryIntent, hasRecoveryIntent
} from './auth-url.mjs';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://skezxxnhsvdrwrdxabje.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9t-QgYU94nmDlBy696rKcQ_Z0IkqiqA';
// Implicit flow: recovery email links carry tokens in the hash and work in any browser.
// PKCE would bind the link to the browser that called resetPasswordForEmail (breaks admin-sent resets).
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {persistSession: true, detectSessionInUrl: false, flowType: 'implicit'}
});

let requests = [];
let notifications = [];
let holidayRows = [];
let coverageConfigured = null; // null → formula
let lastRolloverAt = null;
let me = null;
let loading = true;
let loadError = '';
let session = null;
let authMode = 'signin';
/** True while the user arrived via a password-reset email link. */
let passwordRecovery = false;
let recoveryError = '';
/** Brief success screen after Save new password. */
let passwordSavedOk = false;
let role = 'employee', view = 'overview', modal = null;
let requestFilter = 'all';
let userListFilter = 'all';
let userSearch = '';
/** Admin-only map: profile id → whether Auth user exists (best-effort). */
let authStatusById = {};
/** Highlight a row after submit / notification deep-link. */
let highlightRequestId = null;
let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = iso(new Date());
let lastFocusEl = null;
let realtimeChannel = null;
let pollTimer = null;
const inviteLink = (email) => {
  const base = location.href.split(/[?#]/)[0];
  return email ? `${base}?email=${encodeURIComponent(email)}` : base;
};
const readInviteEmail = () => {
  try { return (new URLSearchParams(location.search || '').get('email') || '').trim().toLowerCase(); }
  catch (_) { return ''; }
};
const isAdmin = () => role === 'admin';
const isManagerRole = () => role === 'manager' || role === 'admin';
const roleLabel = r => r === 'admin' ? 'Admin' : r === 'manager' ? 'Manager' : 'Employee';
const app = document.getElementById('app');
const person = id => people.find(p => p.id === id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = s => parseDate(s).toLocaleDateString('en-CA', {month:'short', day:'numeric'});
const longDate = s => parseDate(s).toLocaleDateString('en-CA', {weekday:'long', month:'long', day:'numeric'});
const range = r => `${pretty(r.start)}${r.start === r.end ? '' : ` – ${pretty(r.end)}`}`;
const daysLabel = n => `${n} ${n === 1 ? 'day' : 'days'}`;
const typeLabel = r => `${r.type}${Number(r.portion) === 0.5 ? ' · Half day' : ''}`;
const mePerson = () => people.find(p => p.id === me);
const teamRequests = () => {
  const manager = mePerson();
  if (!isManagerRole() || !manager) return requests.filter(r => r.person === me);
  return requests.filter(r => r.person === me || managesPerson(manager, person(r.person)));
};
const pendingTeamCount = () => teamRequests().filter(r => r.status === 'pending' && r.person !== me).length;
const unreadCount = () => notifications.filter(n => !n.read).length;

/** Friendlier copy when live PostgREST is missing an RPC the Pages client expects. */
const formatRpcError = (message) => {
  const msg = String(message || '');
  if (/could not find the function|schema cache/i.test(msg)) {
    return `${msg} Run supabase/hotfix_live_rpcs.sql in the Supabase SQL Editor (or the full upgrade_workflow.sql).`;
  }
  return msg;
};

const rpcFor = (path, data) => {
  if (path === '/api/people') return ['upsert_profile', {p_email:data.email, p_name:data.name, p_allowance:data.allowance, p_used:0, p_role:'employee', p_team:data.team || 'General', p_manager_email:data.managerEmail || null, p_active:true}];
  const personEdit = path.match(/^\/api\/people\/([^/]+)$/);
  if (personEdit) return ['upsert_profile', {p_id:personEdit[1], p_name:data.name, p_allowance:data.allowance, p_used:data.used, p_role:data.role, p_team:data.team || 'General', p_manager_email:data.managerEmail || null, p_active:data.active !== false}];
  if (path === '/api/people-active') return ['set_profile_active', {p_id:data.id, p_active:!!data.active}];
  if (path === '/api/requests') return ['submit_leave', {p_person:data.person, p_start:data.start, p_end:data.end, p_note:data.note || '', p_type:data.type, p_portion:data.portion}];
  const requestEdit = path.match(/^\/api\/requests\/([^/]+)$/);
  if (requestEdit) return ['update_leave', {p_request:requestEdit[1], p_start:data.start, p_end:data.end, p_note:data.note || '', p_type:data.type, p_portion:data.portion}];
  const decision = path.match(/^\/api\/requests\/([^/]+)\/decision$/);
  if (decision) return ['decide_leave', {p_request:decision[1], p_decision:data.decision, p_note:data.note || '', p_override:!!data.override}];
  const cancel = path.match(/^\/api\/requests\/([^/]+)\/cancel$/);
  if (cancel) return ['cancel_leave', {p_request:cancel[1]}];
  if (path === '/api/holidays') return ['upsert_holiday', {p_date:data.date, p_name:data.name, p_region:data.region || 'Ontario'}];
  if (path === '/api/holidays-delete') return ['delete_holiday', {p_date:data.date}];
  if (path === '/api/coverage') return ['set_minimum_coverage', {p_minimum:data.minimum}];
  if (path === '/api/rollover') return ['rollover_leave_year', {}];
  throw Error('Unsupported action.');
};
const save = async (path, data) => {
  const [fn, args] = rpcFor(path, data);
  const {error} = await supabase.rpc(fn, args);
  if (error) throw Error(formatRpcError(error.message));
  await loadState();
};

function hydrate(data) {
  setTeam(data.people, data.minimumCoverage);
  setHolidays(data.holidays || []);
  holidayRows = (data.holidays || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  coverageConfigured = data.coverageConfigured;
  requests = data.requests;
  notifications = data.notifications || [];
  me = data.me;
  role = data.role;
}

async function loadState() {
  const profileSelect = await supabase.from('profiles').select('id,email,name,allowance,used,role,team,manager_email,active').order('name');
  // Fallback if upgrade has not added profiles.active yet.
  const profilesRes = profileSelect.error && /active/i.test(profileSelect.error.message)
    ? await supabase.from('profiles').select('id,email,name,allowance,used,role,team,manager_email').order('name')
    : profileSelect;
  const [
    {data:leave, error:requestError},
    {data:holidayData},
    noticeRes,
    settingsRes
  ] = await Promise.all([
    supabase.from('leave_requests').select('id,person,start,end,type,portion,status,note,decision_note,submitted,decided,decided_by').order('submitted', {ascending:false}),
    supabase.from('holidays').select('date,name,region').order('date'),
    supabase.from('notifications').select('id,title,message,read,created_at,request_id').order('created_at', {ascending:false}).limit(25),
    supabase.from('team_settings').select('minimum_coverage,last_rollover_at').eq('id', 1).maybeSingle()
  ]);
  let noticeRows = noticeRes.data;
  if (noticeRes.error && /request_id/i.test(noticeRes.error.message || '')) {
    const fallback = await supabase.from('notifications').select('id,title,message,read,created_at').order('created_at', {ascending:false}).limit(25);
    noticeRows = fallback.data;
  }
  let settingsData = settingsRes.data;
  if (settingsRes.error && /last_rollover/i.test(settingsRes.error.message || '')) {
    const fallback = await supabase.from('team_settings').select('minimum_coverage').eq('id', 1).maybeSingle();
    settingsData = fallback.data;
  }
  const peopleError = profilesRes.error;
  const profiles = (profilesRes.data || []).map(p => ({...p, active: p.active !== false}));
  if (peopleError || requestError) throw Error(peopleError?.message || requestError?.message);
  const email = session.user.email.toLowerCase();
  const current = profiles.find(p => p.email.toLowerCase() === email);
  if (!current) throw Error('Your account has not been added to this team. Ask an admin to add your email address.');
  if (current.active === false) throw Error('Your account is deactivated. Ask an admin to reactivate you.');
  const configured = settingsData?.minimum_coverage ?? null;
  lastRolloverAt = settingsData?.last_rollover_at || null;
  const activeCount = profiles.filter(p => p.active !== false).length;
  const min = configured != null ? configured : Math.max(1, activeCount - 2);
  hydrate({
    people: profiles,
    requests: (leave || []).map(r => ({...r, decisionNote: r.decision_note || ''})),
    holidays: holidayData || [],
    notifications: (noticeRows || []).map(n => ({...n, requestId: n.request_id || null})),
    me: current.id,
    role: current.role,
    minimumCoverage: min,
    coverageConfigured: configured
  });
  if (view === 'users' && !isAdmin()) view = 'overview';
  if (isAdmin()) await loadAuthStatus();
}

/** Best-effort Auth presence for Users list — no service-role key required. */
async function loadAuthStatus() {
  authStatusById = {};
  const {data, error} = await supabase.rpc('list_profile_auth_status');
  if (error || !Array.isArray(data)) return; // RPC missing until upgrade — hide badges
  for (const row of data) {
    if (row?.id) authStatusById[row.id] = !!row.has_auth;
  }
}

function stopLive() {
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startLive() {
  stopLive();
  if (!session) return;
  realtimeChannel = supabase.channel('team-leave-live')
    .on('postgres_changes', {event:'*', schema:'public', table:'leave_requests'}, () => { loadState().then(render).catch(() => {}); })
    .on('postgres_changes', {event:'*', schema:'public', table:'notifications'}, () => { loadState().then(render).catch(() => {}); })
    .subscribe();
  // Light polling fallback when realtime is unavailable for the project.
  pollTimer = setInterval(() => {
    if (document.hidden || !session) return;
    loadState().then(() => {
      if (!modal) render();
      else refreshNoticeBadge();
    }).catch(() => {});
  }, 45000);
}

function refreshNoticeBadge() {
  const btn = document.querySelector('.noticebutton');
  if (!btn) return;
  const n = unreadCount();
  btn.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
  const badge = btn.querySelector('b');
  if (n) {
    if (badge) badge.textContent = String(n);
    else btn.insertAdjacentHTML('beforeend', `<b>${n}</b>`);
  } else if (badge) badge.remove();
}

/** Consume hash/query auth params ourselves so recovery never falls through to Sign in. */
async function establishSessionFromUrl() {
  const parsed = parseAuthUrl();
  if (hasRecoveryIntent()) passwordRecovery = true;
  if (parsed.error) {
    recoveryError = parsed.error;
    return null;
  }

  if (parsed.token_hash && (parsed.type === 'recovery' || passwordRecovery)) {
    passwordRecovery = true;
    const {data, error} = await supabase.auth.verifyOtp({token_hash: parsed.token_hash, type: 'recovery'});
    if (error) throw Error(error.message);
    return data.session;
  }

  if (parsed.access_token && parsed.refresh_token) {
    if (parsed.type === 'recovery') passwordRecovery = true;
    const {data, error} = await supabase.auth.setSession({
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token
    });
    if (error) throw Error(error.message);
    return data.session;
  }

  if (parsed.code) {
    const {data, error} = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error) throw Error(error.message);
    if (parsed.type === 'recovery' || passwordRecovery) passwordRecovery = true;
    return data.session;
  }

  const existing = await supabase.auth.getSession();
  return existing.data.session;
}

async function load() {
  try {
    const inviteEmail = readInviteEmail();
    if (inviteEmail && !session) authMode = 'signup';
    if (hasRecoveryIntent()) passwordRecovery = true;
    session = await establishSessionFromUrl();
    if (parseAuthUrl().hasAuthPayload || parseAuthUrl().looksRecovery) scrubAuthParamsFromUrl();
    if (session && passwordRecovery) {
      try { await loadState(); loadError = ''; }
      catch (e) { loadError = e.message; }
    } else if (session && !passwordRecovery) {
      await loadState();
      startLive();
    } else if (passwordRecovery && !session && !recoveryError) {
      recoveryError = 'This reset link is missing its login tokens. Request a new password reset email and open it on this device.';
    }
    loading = false;
    render();
  } catch (e) {
    loading = false;
    if (passwordRecovery || hasRecoveryIntent()) {
      recoveryError = e.message || 'Could not open this password reset link.';
      passwordRecovery = true;
    } else {
      loadError = e.message;
    }
    render();
  }
}

const mine = () => people.find(p => p.id === me) || people[0];
const avatar = (p, small = false) => `<span class="avatar ${small ? 'small' : ''}" style="--avatar:${p.color}">${p.initials}</span>`;
const badge = status => `<span class="badge ${status}"><i></i>${status[0].toUpperCase() + status.slice(1)}</span>`;
const icon = name => ({overview:'◫', requests:'▤', calendar:'▦', reports:'▥', users:'♙'}[name]);
const riskFor = r => r.type === 'Work From Home' ? [] : coverageFor(r.start, r.end, requests, r.person, r.id).filter(d => d.conflict);
const requestOrder = (a, b) => {
  const pendingA = a.status === 'pending' ? 0 : 1, pendingB = b.status === 'pending' ? 0 : 1;
  if (pendingA !== pendingB) return pendingA - pendingB;
  const riskA = a.status === 'pending' ? riskFor(a).length : 0;
  const riskB = b.status === 'pending' ? riskFor(b).length : 0;
  if (riskB !== riskA) return riskB - riskA;
  return a.start.localeCompare(b.start);
};
const authBadge = (p) => {
  if (p.active === false) return '';
  if (!(p.id in authStatusById)) return '';
  return authStatusById[p.id]
    ? '<span class="authbadge hasauth" title="Has a Supabase Auth account">Has Auth</span>'
    : '<span class="authbadge awaiting" title="Profile only — never created a password">Never signed in</span>';
};

function trapFocus(dialog) {
  const focusables = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
  if (!focusables.length) return () => {};
  const first = focusables[0], last = focusables[focusables.length - 1];
  const onKey = e => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  dialog.addEventListener('keydown', onKey);
  (dialog.querySelector('.dialogclose') || first).focus();
  return () => dialog.removeEventListener('keydown', onKey);
}

let releaseTrap = null;
function afterModalMount() {
  releaseTrap?.();
  releaseTrap = null;
  const dialog = document.querySelector('.dialog');
  if (dialog) releaseTrap = trapFocus(dialog);
}

function openModal(next) {
  lastFocusEl = document.activeElement;
  modal = next;
  render();
}
function closeModal() {
  modal = null;
  render();
  if (lastFocusEl && typeof lastFocusEl.focus === 'function') {
    try { lastFocusEl.focus(); } catch (_) {}
  }
  lastFocusEl = null;
}

function shell(content) {
  const pending = pendingTeamCount();
  const notices = unreadCount();
  return `<div class="shell">
    <aside class="sidebar"><div class="brand"><span class="brandmark"><b></b><b></b><b></b><b></b></span><span>team<span class="brandlight">leave</span></span></div>
      <div class="navlabel">WORKSPACE</div><nav aria-label="Main navigation">
      ${['overview','requests','calendar',...(isManagerRole() ? ['reports'] : []),...(isAdmin() ? ['users'] : [])].map(v => `<button class="navitem ${view === v ? 'active' : ''}" data-view="${v}" ${view === v ? 'aria-current="page"' : ''}><span class="navicon">${icon(v)}</span>${v === 'calendar' ? 'Team calendar' : v[0].toUpperCase() + v.slice(1)}${v === 'requests' && isManagerRole() && pending ? `<span class="navcount">${pending}</span>` : ''}</button>`).join('')}
      </nav><div class="sidebottom"><button class="textbtn" data-action="password">Change password</button><button class="textbtn" data-action="signout">Sign out</button><button class="textbtn" data-action="help">How it works</button></div>
    </aside><div class="workspace"><header class="topbar"><div class="mobilebrand">team<span>leave</span></div><div class="breadcrumb">Workspace <span>/</span> ${view === 'calendar' ? 'Team calendar' : view[0].toUpperCase() + view.slice(1)}</div><div class="toptools"><button class="noticebutton" data-action="notifications" aria-label="${notices ? `Notifications, ${notices} unread` : 'Notifications'}">◔${notices ? `<b>${notices}</b>` : ''}</button><div class="mobileaccount" role="group" aria-label="Account"><button class="textbtn" data-action="password">Password</button><button class="textbtn" data-action="signout">Sign out</button></div><span class="private"><span class="lock">●</span> Private team</span><span class="private">${escapeHtml(mine()?.name || 'Team member')} · ${role}</span>${mine() ? avatar(mine(), true) : ''}</div></header>
    <main class="main">${content}</main></div></div>${modal ? renderModal() : ''}<div id="toast" role="status" aria-live="polite"></div>`;
}

function overview() {
  const balance = remaining(me, requests);
  const pending = teamRequests().filter(r => r.status === 'pending' && (!isManagerRole() || r.person !== me));
  const soon = requests.filter(r => r.status === 'approved' && r.end >= iso(new Date())).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 4);
  const risks = pending.map(r => ({r, days: riskFor(r)})).filter(x => x.days.length);
  const awayNow = new Set(requests.filter(r => r.status === 'approved' && r.start <= iso(new Date()) && r.end >= iso(new Date())).map(r => r.person)).size;
  const head = activePeople().length;
  return `<div class="pageheading"><div><div class="eyebrow">${isManagerRole() ? 'TEAM OVERVIEW' : 'YOUR TIME OFF'}</div><h1>${isManagerRole() ? 'A clearer view of time away.' : 'Make room for time away.'}</h1><p>${isManagerRole() ? 'Review requests, protect coverage, and keep everyone in the loop.' : 'Your leave balance, requests, and team plans in one place.'}</p></div><button class="primary topaction" data-action="new">+ &nbsp;Request time off</button></div>
  <section class="hero"><div class="herotext"><span class="heroeyebrow">${isManagerRole() ? 'TEAM LEAVE / ' + new Date().getFullYear() : 'YOUR LEAVE / ' + new Date().getFullYear()}</span><h2>${isManagerRole() ? 'Plan together.<br>Stay covered.' : 'Time off looks<br>good on you.'}</h2><p>${isManagerRole() ? 'The team’s next decisions and availability, at a glance.' : 'You have ' + balance.available + ' days available to plan this year.'}</p><button class="whitebutton" data-action="${isManagerRole() ? 'queue' : 'new'}">${isManagerRole() ? 'Review requests' : 'Plan time off'} <span>↗</span></button></div><div class="heroart"><div class="artcircle one"></div><div class="artcircle two"></div><div class="artcard"><div class="artrow"><span class="artsun">✳</span><span>TIME TO RESET</span></div><div class="artdays">${isManagerRole() ? pending.length : balance.available}<span>${isManagerRole() ? 'to review' : 'days left'}</span></div><div class="artline"><span></span><span></span><span></span></div></div></div></section>
  <section class="stats" aria-label="At a glance"><div class="stat"><div class="stathead"><span>Available to use</span><span class="statglyph lavender">✳</span></div><strong>${balance.available}<small> days</small></strong><div class="statfoot">Your ${new Date().getFullYear()} vacation balance</div></div><div class="stat"><div class="stathead"><span>${isManagerRole() ? 'Awaiting your review' : 'Your pending requests'}</span><span class="statglyph peach">◷</span></div><strong>${isManagerRole() ? pending.length : requests.filter(r => r.status === 'pending' && r.person === me).length}<small> requests</small></strong><div class="statfoot">${isManagerRole() ? 'Aim to respond within 2 business days' : 'Waiting for manager approval'}</div></div><div class="stat"><div class="stathead"><span>Team away today</span><span class="statglyph mint">◉</span></div><strong>${awayNow}<small> people</small></strong><div class="statfoot">${head - awayNow} of ${head} available</div></div></section>
  <p class="glossaryhint"><b>Vacation</b> burns annual days. <b>Work From Home</b>, Sick, Personal, and Unpaid do not — WFH also skips coverage impact.</p>
  <div class="overviewgrid"><section class="panel"><div class="sectionhead"><div><span class="eyebrow">COMING UP</span><h3>Upcoming absences</h3></div><button class="linkbutton" data-view="calendar">View calendar <span>→</span></button></div>${soon.length ? `<div class="absence-list">${soon.map(r => `<div class="absence">${avatar(person(r.person))}<div class="absenceperson"><b>${escapeHtml(person(r.person)?.name || 'Teammate')}</b><span>${typeLabel(r)} · ${daysLabel(requestDuration(r))}</span></div><time>${range(r)}</time></div>`).join('')}</div>` : '<div class="empty">No upcoming approved time off yet.</div>'}</section>
  <section class="panel coveragepanel"><div class="sectionhead"><div><span class="eyebrow">COVERAGE WATCH</span><h3>Needs a closer look</h3></div><span class="countpill">${risks.length} ${risks.length === 1 ? 'conflict' : 'conflicts'}</span></div>${risks.length ? risks.slice(0, 2).map(({r, days}) => `<div class="riskitem"><span class="riskicon">!</span><div><b>${escapeHtml(person(r.person)?.name || '')} · ${range(r)}</b><p>${daysLabel(days.length)} below ${minimumCoverage}-person minimum if approved. ${days[0].available} available on ${pretty(days[0].date)}.</p>${isManagerRole() ? `<button class="smalllink" data-review="${r.id}">Review request →</button>` : ''}</div></div>`).join('') : '<div class="goodstate"><span>✓</span><div><b>Coverage looks healthy</b><p>No pending requests currently fall below your team minimum.</p></div></div>'}<div class="coveragefoot">Based on approved leave · minimum ${minimumCoverage} of ${head} available</div></section></div>`;
}

function requestRows(items, manager) {
  if (!items.length) return '<div class="empty">Nothing here yet. New requests will show up as soon as they are submitted.</div>';
  return `<div class="tablewrap"><table><thead><tr>${manager ? '<th>Employee</th>' : ''}<th>Dates</th><th>Duration</th><th>Status</th>${manager ? '<th>Coverage</th>' : ''}<th class="right">Action</th></tr></thead><tbody>${items.map(r => {
    const risks = r.status === 'pending' ? riskFor(r) : [];
    const p = person(r.person);
    const ownPending = r.status === 'pending' && r.person === me;
    const canReview = manager && r.status === 'pending' && r.person !== me;
    const action = canReview
      ? `<button class="rowaction" data-review="${r.id}">Review →</button>`
      : ownPending
        ? `<button class="rowaction" data-editrequest="${r.id}">Edit</button> <button class="rowaction muted" data-cancel="${r.id}">Cancel</button>`
        : '<span class="dash">—</span>';
    return `<tr class="${highlightRequestId === r.id ? 'rowhighlight' : ''}" data-request-row="${r.id}">${manager ? `<td><div class="cellperson">${p ? avatar(p, true) : ''}<b>${escapeHtml(p?.name || 'Unknown')}</b></div></td>` : ''}<td><b>${range(r)}</b><span class="cellsub">${typeLabel(r)}</span></td><td>${daysLabel(requestDuration(r))}</td><td>${badge(r.status)}${r.decisionNote ? `<span class="cellsub decisionnote">${escapeHtml(r.decisionNote)}</span>` : ''}</td>${manager ? `<td>${risks.length ? `<span class="impact caution">⚠ ${daysLabel(risks.length)} at risk</span>` : '<span class="impact good">✓ Covered</span>'}</td>` : ''}<td class="right">${action}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function requestsPage() {
  const source = teamRequests();
  const list = source.filter(r => requestFilter === 'all' || r.status === requestFilter).sort(requestOrder);
  const pending = list.filter(r => r.status === 'pending' && (!isManagerRole() || r.person !== me)).length;
  const b = remaining(me, requests);
  return `<div class="pageheading"><div><div class="eyebrow">${isManagerRole() ? 'APPROVALS' : 'MY REQUESTS'}</div><h1>${isManagerRole() ? 'Requests & decisions' : 'Your requests'}</h1><p>${isManagerRole() ? 'You only see and decide requests for your team (same team name or people who list your email as manager). Habit: open Requests each morning — notifications are in-app only (badge refreshes about every 45s). Aim to respond within 2 business days.' : 'Submit time off and follow each request through to a decision.'}</p></div><button class="primary topaction" data-action="new">+ &nbsp;Request time off</button></div>
  <section class="balancebar"><div><span class="eyebrow">${new Date().getFullYear()} VACATION</span><strong>${b.available} <small>days available</small></strong></div><div class="balanceitems"><span><b>${b.allowance}</b> annual</span><span><b>${b.used}</b> carry-in</span><span><b>${b.approved}</b> approved Vacation</span><span><b>${b.pending}</b> pending Vacation</span></div></section>
  ${isManagerRole() ? `<div class="queueintro"><span class="queueicon">◷</span><div><b>${pending} ${pending === 1 ? 'request needs' : 'requests need'} a decision</b><span>Coverage warnings use a ${minimumCoverage}-person minimum${coverageConfigured == null ? ' (auto: headcount − 2)' : ''}. Your own pending requests show Edit / Cancel below.</span></div></div>` : ''}
  <section class="panel requestspanel"><div class="sectionhead"><div><span class="eyebrow">${isManagerRole() ? 'YOUR TEAM' : 'HISTORY'}</span><h3>${isManagerRole() ? 'Team requests' : 'All your requests'}</h3></div><div class="filtertabs">${['all','pending','approved','declined','cancelled'].map(s => `<button class="${requestFilter === s ? 'active' : ''}" data-filter="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></div>${requestRows(list, isManagerRole())}</section>`;
}

function calendarPage() {
  const year = month.getFullYear(), m = month.getMonth(), first = new Date(year, m, 1), offset = (first.getDay() + 6) % 7;
  const length = new Date(year, m + 1, 0).getDate(), cells = Math.ceil((offset + length) / 7) * 7;
  const days = Array.from({length: cells}, (_, i) => addDays(first, i - offset));
  const chosen = requests.filter(r => r.start <= selectedDay && r.end >= selectedDay && r.status === 'approved');
  const pendingOnDay = teamRequests().filter(r => r.start <= selectedDay && r.end >= selectedDay && r.status === 'pending');
  const availability = coverageFor(selectedDay, selectedDay, requests)[0];
  const head = activePeople().length;
  const dayHoliday = holidays.includes(selectedDay) ? holidayName(selectedDay) : '';
  return `<div class="pageheading"><div><div class="eyebrow">TEAM AVAILABILITY</div><h1>Everyone, in the picture.</h1><p>Approved absences and pending plans in a single shared view.</p></div><button class="primary topaction" data-action="new">+ &nbsp;Request time off</button></div>
  <div class="calendargrid"><section class="panel calendarpanel"><div class="calendarhead"><div><span class="eyebrow">TEAM CALENDAR</span><h3>${month.toLocaleDateString('en-CA', {month:'long', year:'numeric'})}</h3></div><div class="monthbuttons"><button data-action="prevmonth" aria-label="Previous month">‹</button><button data-action="today">Today</button><button data-action="nextmonth" aria-label="Next month">›</button></div></div><div class="calweek">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x => `<span>${x}</span>`).join('')}</div><div class="caldays">${days.map(d => {
    const date = iso(d), active = d.getMonth() === m, events = requests.filter(r => r.start <= date && r.end >= date && r.status === 'approved'), waits = requests.filter(r => r.start <= date && r.end >= date && r.status === 'pending');
    const hName = holidays.includes(date) ? holidayName(date) : '';
    const label = `${longDate(date)}${hName ? `, ${hName}` : ''}, ${events.length} approved absences`;
    return `<button class="calday ${active ? '' : 'outside'} ${selectedDay === date ? 'chosen' : ''} ${date === iso(new Date()) ? 'todaydate' : ''}" data-date="${date}" aria-label="${escapeHtml(label)}"><span class="daynum">${d.getDate()}</span><span class="calentries">${events.slice(0, 2).map(r => `<span class="calentry" style="--event:${person(r.person)?.color || '#d6e3ff'}">${escapeHtml((person(r.person)?.name || '').split(' ')[0])}</span>`).join('')}${events.length > 2 ? `<span class="moreevents">+${events.length - 2} more</span>` : ''}${hName ? `<span class="holidaydot" title="${escapeHtml(hName)}">${escapeHtml(hName)}</span>` : ''}${waits.length ? `<span class="pendingdot" title="${waits.length} pending">· ${waits.length} pending</span>` : ''}</span></button>`;
  }).join('')}</div><div class="callegend"><span><i class="legendapproved"></i>Approved</span><span><i class="legendpending"></i>Pending</span><span class="callegendhint">On mobile, tap a day to see names</span></div></section>
  <aside class="panel daypanel"><span class="eyebrow">DAILY SNAPSHOT</span><h3>${longDate(selectedDay)}</h3>${dayHoliday ? `<div class="holidayflag">${escapeHtml(dayHoliday)}</div>` : ''}<div class="coveragefigure"><strong>${availability ? availability.available : head}<small> / ${head}</small></strong><span>available to work</span></div><div class="meter"><span style="width:${(availability ? availability.available : head) / Math.max(1, head) * 100}%"></span></div><p class="threshold ${availability?.conflict ? 'at-risk' : ''}">${availability?.conflict ? '⚠ Below coverage minimum' : `✓ Minimum ${minimumCoverage} people covered`}</p><div class="daydivider"></div><h4>Away that day <span>${chosen.length}</span></h4>${chosen.length ? chosen.map(r => `<div class="dayperson">${avatar(person(r.person), true)}<div><b>${escapeHtml(person(r.person)?.name || '')}</b><span>${typeLabel(r)} · ${range(r)}</span></div></div>`).join('') : '<p class="quiet">Nobody is away on approved leave.</p>'}${pendingOnDay.length ? `<h4 class="pendingtitle">Pending <span>${pendingOnDay.length}</span></h4>${pendingOnDay.map(r => `<div class="dayperson">${avatar(person(r.person), true)}<div><b>${escapeHtml(person(r.person)?.name || '')}</b><span>Awaiting approval</span></div></div>`).join('')}` : ''}</aside></div>`;
}

function reportsPage() {
  const approved = requests.filter(r => r.status === 'approved');
  const used = approved.reduce((n, r) => n + balanceDuration(r), 0);
  const teams = [...new Set(people.map(p => p.team || 'General'))];
  const formula = Math.max(1, activePeople().length - 2);
  const meP = mePerson();
  const utilPeople = isAdmin()
    ? people.filter(p => p.active !== false)
    : people.filter(p => p.active !== false && (p.id === me || managesPerson(meP, p)));
  const pendingVacation = teamRequests().filter(r => r.status === 'pending' && r.type === 'Vacation' && r.person !== me);
  const rolloverNote = lastRolloverAt
    ? `Last rollover: ${new Date(lastRolloverAt).toLocaleString('en-CA', {dateStyle:'medium', timeStyle:'short'})}.`
    : 'No rollover timestamp recorded yet (run upgrade SQL to track it).';
  return `<div class="pageheading"><div><div class="eyebrow">TEAM INSIGHTS</div><h1>Leave reports</h1><p>Balances, utilization, holidays, and year-end checklist for ${new Date().getFullYear()}.</p></div><div class="reportactions"><button class="secondary" data-action="manageholidays">Manage holidays</button><button class="secondary" data-action="exportics">Export calendar</button><button class="primary" data-action="exportcsv">Export CSV</button></div></div>
  <p class="quiet exportnote">CSV includes all statuses. ICS export is <b>approved</b> leave only.</p>
  <section class="stats"><div class="stat"><div class="stathead"><span>Approved leave</span></div><strong>${used}<small> days</small></strong></div><div class="stat"><div class="stathead"><span>Pending decisions</span></div><strong>${pendingTeamCount()}<small> requests</small></strong></div><div class="stat"><div class="stathead"><span>Teams</span></div><strong>${teams.length}<small> groups</small></strong></div></section>
  <section class="panel reportpanel"><div class="sectionhead"><div><span class="eyebrow">COVERAGE</span><h3>Minimum people available</h3></div></div>
  <form id="coverageform" class="inlineform"><label>Minimum coverage <span class="optional">Leave blank for auto (${formula})</span><input name="minimum" type="number" min="1" max="${activePeople().length}" value="${coverageConfigured ?? ''}" placeholder="${formula}"></label><button class="secondary" type="submit">Save coverage</button></form>
  <p class="quiet">Current effective minimum: <b>${minimumCoverage}</b>${coverageConfigured == null ? ' (auto: active headcount − 2)' : ' (configured)'}.</p></section>
  <section class="panel reportpanel"><div class="sectionhead"><div><span class="eyebrow">YEAR END</span><h3>Leave-year checklist</h3></div></div>
  <ol class="checklist"><li>Confirm all pending Vacation for this year is decided${pendingVacation.length ? ` — <b class="dangertext">${pendingVacation.length} still pending</b>` : ''}.</li><li>Export CSV / ICS for records if needed.</li><li>Carry-over policy defaults to <b>0</b> — unused vacation does not roll into next year.</li><li>Run rollover to reset carry-in (<code>profiles.used</code>) to 0 for your team.</li></ol>
  <p class="quiet">${rolloverNote}</p>
  <button class="secondary" data-action="rollover">Reset carry-in for my team (carry-over = 0)</button>
  <p class="quiet">Approved Vacation history is not deleted. Only the manual carry-in field is cleared. Do not run rollover early while Vacation requests are still pending.</p></section>
  <section class="panel reportpanel"><div class="sectionhead"><div><span class="eyebrow">BALANCES</span><h3>Team utilization</h3></div></div>
  <p class="quiet">${isAdmin() ? 'Showing all active profiles.' : 'Showing your team only (same team or people who list you as manager).'}</p>
  <div class="reportrows">${utilPeople.map(p => { const b = remaining(p.id, requests), pct = Math.min(100, Math.round((b.used + b.approved) / Math.max(1, b.allowance) * 100)); return `<div class="reportrow"><div>${avatar(p, true)}<span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.team || 'General')}</small></span></div><div class="reportbar"><i style="width:${pct}%"></i></div><strong>${b.used + b.approved} / ${b.allowance}</strong></div>`; }).join('') || '<div class="empty">No teammates in scope.</div>'}</div></section>`;
}

function usersPage() {
  if (!isAdmin()) {
    return `<div class="pageheading"><div><div class="eyebrow">RESTRICTED</div><h1>Admin access required</h1><p>Only administrators can open Team users. Ask an admin if you need a profile change, allowance update, or password reset link.</p></div></div>
    <section class="panel"><div class="okbox">You can still change your own password from the sidebar (or Password on mobile).</div></section>`;
  }
  const q = userSearch.trim().toLowerCase();
  const filtered = people.filter(p => {
    if (userListFilter === 'active' && p.active === false) return false;
    if (userListFilter === 'deactivated' && p.active !== false) return false;
    if (!q) return true;
    return (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
  });
  return `<div class="pageheading"><div><div class="eyebrow">ACCOUNT & ACCESS</div><h1>Team users</h1><p>Admin-only: manage roles, leave balances, deactivate people, and send password reset links.</p></div><div class="reportactions"><button class="primary topaction" data-action="adduser">+ Add user</button></div></div>
  <section class="panel userspanel"><div class="sectionhead"><div><span class="eyebrow">TEAM DIRECTORY</span><h3>${filtered.length} of ${people.length} users</h3></div>
  <div class="filtertabs">${[['all','All'],['active','Active'],['deactivated','Deactivated']].map(([k,label]) => `<button class="${userListFilter === k ? 'active' : ''}" data-userfilter="${k}">${label}</button>`).join('')}</div></div>
  <label class="usersearch">Search<input type="search" id="usersearch" value="${escapeHtml(userSearch)}" placeholder="Name or email" autocomplete="off"></label>
  <div class="userlist">${filtered.map(p => {
    const awaiting = p.active !== false && (p.id in authStatusById) && !authStatusById[p.id];
    return `<div class="userrow ${p.active === false ? 'inactive' : ''}">${avatar(p)}<div class="useridentity"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.email || '')} · ${escapeHtml(p.team || 'General')}${p.active === false ? ' · Deactivated' : ''}</span>${authBadge(p)}</div><span class="userrole">${roleLabel(p.role)}</span><span class="userbalance"><b>${remaining(p.id, requests).available}</b> days available</span><div class="useractions">${awaiting ? `<button class="rowaction" data-resendinvite="${p.id}">Resend invite</button>` : ''}<button class="rowaction" data-edituser="${p.id}" aria-label="Edit ${escapeHtml(p.name)}">Edit</button></div></div>`;
  }).join('') || '<div class="empty">No users match this filter.</div>'}</div></section>
  <p class="userhint">Adding a user creates their team profile only (role starts as Employee — promote later in Edit). Share the invite link with <code>?email=</code> so Create password is prefilled. Deactivating keeps leave history and blocks Create password / sign-in. Auth status badges need the live SQL upgrade (<code>list_profile_auth_status</code>).</p>`;
}

function renderModal() {
  if (modal.kind === 'invite') {
    const link = inviteLink(modal.email);
    const body = `You have been added to Team Leave.\n\n1. Open: ${link}\n2. Choose Create password (or Sign in if you already have an account)\n3. Your email is prefilled: ${modal.email}\n\nCreate your own password — none is shared by email.`;
    return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">PROFILE READY</div><h2>Invite them to create a password</h2><p class="dialoglead">Their work email is on the team. Share the invite link (email is prefilled). They create their own password. No temporary password is generated.</p><div class="requestnote"><span>ACCESS LINK</span><p>${escapeHtml(link)}</p><span>EMAIL</span><p>${escapeHtml(modal.email)}</p></div><div class="dialogactions"><button class="secondary" data-copy-invite="${encodeURIComponent(body)}">Copy invite</button><a class="primary mailbutton" href="mailto:${encodeURIComponent(modal.email)}?subject=${encodeURIComponent('Your Team Leave access')}&body=${encodeURIComponent(body)}">Open email</a><button class="primary" data-action="close">Done</button></div></div></div>`;
  }
  if (modal.kind === 'help') {
    return `<div class="scrim" data-action="close"><div class="dialog dialogwide" role="dialog" aria-modal="true"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">ONBOARDING</div><h2>How Team Leave access works</h2><p class="dialoglead">English checklist for first-time access and password resets.</p>
    <ol class="checklist">
      <li><b>Admin adds</b> the person on Users → Add user (profile only, starts as Employee).</li>
      <li><b>Share the invite link</b> (Copy invite / Open email). The link includes <code>?email=</code> so Create password is prefilled.</li>
      <li>They open the app → <b>Create password</b> → then <b>Sign in</b>.</li>
      <li><b>Forgot password</b> only works after they already created a password once. New invites use Create password, not Forgot.</li>
      <li>If a reset email opens Sign in with no set-password screen, Auth URL Configuration in Supabase is wrong (see README / ops checklist).</li>
      <li>Deactivated accounts: ask an <b>admin</b> to reactivate — managers cannot do this.</li>
      <li>Managers: open <b>Requests</b> each morning. Notifications are in-app only (no email alerts).</li>
    </ol>
    <div class="dialogactions"><button class="primary" data-action="close">Got it</button></div></div></div>`;
  }
  if (modal.kind === 'password') return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">ACCOUNT SECURITY</div><h2>Change password</h2><p class="dialoglead">Use at least 8 characters. Your current session will stay signed in.</p><form id="passwordform"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm password<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label><div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button class="primary" type="submit">Update password</button></div></form></div></div>`;
  if (modal.kind === 'resetconfirm') {
    const p = person(modal.id); if (!p) return '';
    return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">PASSWORD RESET</div><h2>Send reset email?</h2><p class="dialoglead">Supabase will email a one-time link to this address. No temporary password is created.</p><div class="requestnote"><span>EMAIL</span><p>${escapeHtml(p.email)}</p></div><div class="requestnote"><span>REQUIREMENT</span><p>They must already have used Create password once. If they were only invited and never set a password, share the invite link and ask them to use Create password instead.</p></div><div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button type="button" class="secondary" data-action="backtoedituser">Back</button><button type="button" class="primary" data-action="confirmreset">Send reset email</button></div></div></div>`;
  }
  if (modal.kind === 'notifications') return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">UPDATES</div><h2>Notifications</h2><p class="dialoglead">In-app only — Team Leave does not send email. Tap an item to open the related request when available.</p><div class="notificationlist">${notifications.length ? notifications.map(n => `<button type="button" class="notification ${n.read ? '' : 'unread'}" data-open-notice="${n.id}" ${n.requestId ? `data-request="${n.requestId}"` : ''}><b>${escapeHtml(n.title)}</b><p>${escapeHtml(n.message)}</p><time>${new Date(n.created_at).toLocaleString('en-CA', {dateStyle:'medium', timeStyle:'short'})}</time></button>`).join('') : '<div class="empty">You are all caught up.</div>'}</div></div></div>`;
  if (modal.kind === 'manageholidays') {
    const year = new Date().getFullYear();
    return `<div class="scrim" data-action="close"><div class="dialog dialogwide" role="dialog" aria-modal="true"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">TEAM CALENDAR</div><h2>Holidays</h2><p class="dialoglead">Holidays are excluded from leave duration. Edit a row, delete, or load Ontario ESA holidays.</p>
    <div class="reportactions" style="margin-bottom:14px"><button type="button" class="secondary" data-action="loadontario" data-year="${year}">Load Ontario ${year}</button><button type="button" class="secondary" data-action="loadontario" data-year="${year + 1}">Load Ontario ${year + 1}</button><button type="button" class="secondary" data-action="addholiday">Add holiday</button></div>
    <div class="holidaylist">${holidayRows.length ? holidayRows.map(h => `<div class="holidayrow" data-holiday="${h.date}"><div><b>${escapeHtml(h.name)}</b><span>${h.date} · ${escapeHtml(h.region || 'Ontario')}</span></div><div class="holidayactions"><button type="button" class="rowaction" data-editholiday="${h.date}">Edit</button><button type="button" class="rowaction muted" data-deleteholiday="${h.date}">Delete</button></div></div>`).join('') : '<div class="empty">No holidays yet.</div>'}</div></div></div>`;
  }
  if (modal.kind === 'addholiday' || modal.kind === 'editholiday') {
    const editing = modal.kind === 'editholiday';
    const current = editing ? holidayRows.find(h => h.date === modal.date) : null;
    return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">TEAM CALENDAR</div><h2>${editing ? 'Edit' : 'Add'} a holiday</h2><p class="dialoglead">Holidays are excluded from leave duration calculations.</p><form id="holidayform"><label>Date<input name="date" type="date" required value="${escapeHtml(current?.date || '')}" ${editing ? 'readonly' : ''}></label><label>Holiday name<input name="name" maxlength="100" required placeholder="e.g. Thanksgiving" value="${escapeHtml(current?.name || '')}"></label><div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button class="primary" type="submit">${editing ? 'Save holiday' : 'Add holiday'}</button></div></form></div></div>`;
  }
  if (modal.kind === 'edituser') {
    const p = person(modal.id); if (!p) return '';
    const resetOk = modal.resetSent
      ? `<div class="okbox" id="resetfeedback" role="status">Password reset link sent to ${escapeHtml(p.email)}. They open the email link, set a new password on the Team Leave page, then sign in. No temporary password.</div>`
      : modal.resetError
        ? `<div class="formerror" id="resetfeedback" role="alert">${escapeHtml(modal.resetError)}</div>`
        : `<div id="resetfeedback"></div>`;
    const awaiting = p.active !== false && (p.id in authStatusById) && !authStatusById[p.id];
    return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">USER DETAILS</div><h2 id="dialog-title">Edit ${escapeHtml(p.name)}</h2><p class="dialoglead">Update role, team, leave balance, or send a password reset link.${authBadge(p) ? ` ${authBadge(p)}` : ''}</p><form id="edituserform"><label>Email<input type="email" value="${escapeHtml(p.email || '')}" readonly tabindex="-1" aria-readonly="true"></label><p class="quiet">Email matches their Auth account and cannot be changed here.</p><label>Name<input name="name" maxlength="100" value="${escapeHtml(p.name)}" required></label><div class="formrow"><label>Team<input name="team" maxlength="80" value="${escapeHtml(p.team || 'General')}" required></label><label>Manager email<input name="managerEmail" type="email" value="${escapeHtml(p.manager_email || '')}"></label></div><div class="formrow"><label>Annual allowance<input name="allowance" type="number" min="0" max="100" value="${p.allowance}" required></label><label>Carry-in / adjustment<input name="used" type="number" min="0" max="100" value="${p.used}" required></label></div><label>Role<select name="role"><option value="employee" ${p.role === 'employee' ? 'selected' : ''}>Employee</option><option value="manager" ${p.role === 'manager' ? 'selected' : ''}>Manager</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option></select></label><label class="checkline"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Active (uncheck to deactivate without deleting history)</label><p class="quiet">Carry-in is manual only — approved Vacation requests are counted separately. Available = allowance − carry-in − approved Vacation. Carry-over into a new year defaults to 0.</p>${awaiting ? `<p class="quiet">This person has never signed in — use Resend invite from the Users list, not Reset password.</p>` : ''}${resetOk}<div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button class="secondary" type="button" data-action="resetpassword" ${p.active === false ? 'disabled title="Reactivate the user before sending a reset link"' : ''}>Reset password</button><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save changes</button></div></form></div></div>`;
  }
  if (modal.kind === 'adduser') return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">NEW USER</div><h2 id="dialog-title">Add user</h2><p class="dialoglead">Create their team profile (starts as Employee — you can promote them to Manager or Admin later in Edit). They create their own password from the sign-in page.</p><form id="teamform"><label>Name<input name="name" maxlength="100" required></label><label>Email<input name="email" type="email" required></label><div class="formrow"><label>Team<input name="team" value="${escapeHtml(mine()?.team || 'General')}" required></label><label>Manager email<input name="managerEmail" type="email" value="${escapeHtml(mine()?.email || '')}"></label></div><label>Annual vacation days<input name="allowance" type="number" min="0" max="100" value="25" required></label><div id="formerror" role="alert" class="formerror"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button class="primary" type="submit">Add to team</button></div></form></div></div>`;
  if (modal.kind === 'new' || modal.kind === 'editrequest') {
    const editing = modal.kind === 'editrequest', current = editing ? requests.find(x => x.id === modal.id) : null;
    if (editing && !current) return '';
    const start = current?.start || iso(addBusinessDays(new Date(), 7)), end = current?.end || iso(addBusinessDays(new Date(), 8)), selectedPerson = current?.person || me;
    const options = isManagerRole()
      ? people.filter(p => p.active !== false && (p.id === me || managesPerson(mePerson(), p)))
      : people.filter(p => p.id === me);
    return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">${editing ? 'EDIT' : 'NEW'} REQUEST</div><h2 id="dialog-title">${editing ? 'Update' : 'Submit'} a request</h2><p class="dialoglead">Request leave or a work-from-home day. Your manager will review the details.</p><form id="requestform"><label>Employee<select name="person" ${(role === 'employee' || editing) ? 'disabled' : ''}>${options.map(p => `<option value="${p.id}" ${p.id === selectedPerson ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label><div class="formrow"><label>Request type<select name="type">${['Vacation','Sick','Personal','Unpaid','Work From Home'].map(t => `<option ${t === (current?.type || 'Vacation') ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Duration<select name="portion"><option value="1" ${Number(current?.portion || 1) === 1 ? 'selected' : ''}>Full day(s)</option><option value="0.5" ${Number(current?.portion) === 0.5 ? 'selected' : ''}>Half day</option></select></label></div><div class="formrow"><label>Start date<input name="start" type="date" min="${iso(new Date())}" value="${start}" required></label><label>End date<input name="end" type="date" min="${iso(new Date())}" value="${end}" required></label></div><label>Note for manager <span class="optional">Optional</span><textarea name="note" maxlength="500" placeholder="Anything helpful for planning coverage">${escapeHtml(current?.note || '')}</textarea></label><div id="requestpreview" class="requestpreview"></div><div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" class="primary">${editing ? 'Update request' : 'Submit request →'}</button></div></form></div></div>`;
  }
  const r = requests.find(x => x.id === modal.id); if (!r) return '';
  const risk = riskFor(r), b = remaining(r.person, requests);
  const reviewDays = requestDuration(r), burn = balanceDuration(r);
  const head = activePeople().length;
  return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">MANAGER DECISION</div><h2 id="dialog-title">Review time off</h2><div class="reviewperson">${avatar(person(r.person))}<div><b>${escapeHtml(person(r.person)?.name || '')}</b><span>${typeLabel(r)} · ${range(r)} · ${daysLabel(reviewDays)}</span></div>${badge(r.status)}</div><div class="reviewfacts"><div><span>Balance after approval</span><b>${b.available - burn} days</b></div><div><span>Coverage impact</span><b class="${risk.length ? 'dangertext' : ''}">${risk.length ? `${daysLabel(risk.length)} below minimum` : 'No conflict'}</b></div></div>${risk.length ? `<div class="warnbox"><b>⚠ Coverage conflict</b><p>Approving this request leaves ${risk[0].available} of ${head} people available on ${risk.map(x => pretty(x.date)).join(', ')}. Your minimum is ${minimumCoverage}.</p></div>` : '<div class="okbox">✓ Team coverage meets the minimum for these dates.</div>'}${r.note ? `<div class="requestnote"><span>EMPLOYEE NOTE</span><p>${escapeHtml(r.note)}</p></div>` : ''}<form id="decisionform"><label>Decision note <span class="optional">${risk.length ? 'Required when overriding coverage' : 'Required to decline'}</span><textarea name="decisionNote" maxlength="500" placeholder="${risk.length ? 'Briefly note how coverage is arranged' : 'Add context for the employee'}"></textarea></label>${risk.length ? `<label class="checkline"><input type="checkbox" name="override" id="overrideCoverage"> I’ve arranged coverage and want to approve anyway.</label>` : ''}<div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" name="decision" value="declined" class="declinebutton">Decline</button><button type="submit" name="decision" value="approved" class="primary" ${risk.length ? 'disabled' : ''} id="approveBtn">Approve →</button></div></form></div></div>`;
}

function renderRecovery() {
  if (session) {
    const notice = loadError
      ? `<div class="warnbox" role="status"><b>Note</b><p>${escapeHtml(loadError)} You can still set a new password; ask an admin to fix access before signing in again.</p></div>`
      : '';
    const recoveryEmail = session.user?.email || '';
    return `<main class="loginpage"><section class="logincard"><span class="brandmark"><b></b><b></b><b></b><b></b></span><div class="eyebrow">PASSWORD RESET</div><h1>Set a new password</h1><p>Choose a new password for this account. Use at least 8 characters.</p>${notice}<form id="recoveryform"><label>Email<input type="email" value="${escapeHtml(recoveryEmail)}" readonly tabindex="-1" aria-readonly="true"></label><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="At least 8 characters"></label><label>Confirm password<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required placeholder="Repeat your password"></label><div id="formerror" class="formerror" role="alert"></div><button class="primary" type="submit">Save new password</button></form><button class="loginlink" data-action="cancelrecovery">Cancel and return to sign in</button><p class="loginhelp">This link came from a Team Leave password reset email. After saving, you can sign in with the new password.</p></section></main>`;
  }
  const detail = recoveryError
    || 'Open the newest reset link from your email. If it still fails, ask an admin to send Reset password again.';
  return `<main class="loginpage"><section class="logincard"><span class="brandmark"><b></b><b></b><b></b><b></b></span><div class="eyebrow">PASSWORD RESET</div><h1>Could not open reset link</h1><p>Team Leave needs a valid reset link to let you set a new password. You should not use Sign in with the old password here.</p><div class="warnbox" role="alert"><b>What happened</b><p>${escapeHtml(detail)}</p></div><button class="primary" data-action="cancelrecovery">Back to sign in</button><button class="loginlink" data-auth-mode="forgot">Request a new reset email</button><p class="loginhelp">Tip: use the latest email only. Links expire. Admin-sent resets open on any device after this fix.</p></section></main>`;
}

function render() {
  if (loading) { app.innerHTML = '<main class="main"><h1>Loading team leave…</h1></main>'; return; }
  if (passwordSavedOk && session) {
    app.innerHTML = `<main class="loginpage"><section class="logincard"><span class="brandmark"><b></b><b></b><b></b><b></b></span><div class="eyebrow">PASSWORD SAVED</div><h1>You're ready</h1><p>Your new password is saved. Continue to the workspace, or sign out if this is not your device.</p>${loadError ? `<div class="warnbox" role="status"><b>Note</b><p>${escapeHtml(loadError)}</p></div>` : ''}<button class="primary" data-action="enterworkspace">Continue to workspace</button><button class="loginlink" data-action="signout">Sign out</button></section></main>`;
    return;
  }
  // Never show Sign in / Create password while a recovery link (or intent) is active.
  if (passwordRecovery || hasRecoveryIntent()) {
    passwordRecovery = true;
    app.innerHTML = renderRecovery();
    return;
  }
  if (!session) {
    const creating = authMode === 'signup', forgot = authMode === 'forgot';
    const prefill = readInviteEmail();
    app.innerHTML = `<main class="loginpage"><section class="logincard"><span class="brandmark"><b></b><b></b><b></b><b></b></span><div class="eyebrow">PRIVATE TEAM</div><h1>Team Leave</h1><p>${forgot ? 'Enter your work email. If you already created a password, we send a reset link. If you were invited and never set one, use Create password instead.' : creating ? 'Create a password for your invited work email.' : 'Sign in with your work email and password.'}</p>${forgot ? '' : `<div class="authtabs" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected="${!creating}" class="${!creating ? 'active' : ''}" data-auth-mode="signin">Sign in</button><button type="button" role="tab" aria-selected="${creating}" class="${creating ? 'active' : ''}" data-auth-mode="signup">Create password</button></div>`}<form id="loginform"><label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@company.com" value="${escapeHtml(prefill)}"></label>${forgot ? '' : `<label>Password<input name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" minlength="8" required placeholder="At least 8 characters"></label>${creating ? '<label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="Repeat your password"></label>' : ''}`}<div id="formerror" class="formerror" role="alert"></div><button class="primary" type="submit">${forgot ? 'Send reset link' : creating ? 'Create password' : 'Sign in'}</button></form>${forgot ? '<button class="loginlink" data-auth-mode="signup">Never created a password? Create password</button><button class="loginlink" data-auth-mode="signin">← Back to sign in</button>' : '<button class="loginlink" data-auth-mode="forgot">Forgot password?</button>'}<p class="loginhelp">Access is limited to email addresses already added by an admin. Deactivated accounts cannot sign in — ask an <b>admin</b> to reactivate. Notifications are in-app only.</p></section></main>`;
    return;
  }
  if (loadError) { app.innerHTML = `<main class="loginpage"><section class="logincard"><h1>Unable to open Team Leave</h1><p>${escapeHtml(loadError)}</p><button class="primary" data-action="signout">Return to sign in</button></section></main>`; return; }
  const page = view === 'users' && !isAdmin() ? usersPage() : view === 'overview' ? overview() : view === 'requests' ? requestsPage() : view === 'users' ? usersPage() : view === 'reports' ? reportsPage() : calendarPage();
  app.innerHTML = shell(page);
  if (modal?.kind === 'new' || modal?.kind === 'editrequest') updatePreview();
  if (modal) afterModalMount();
  if (highlightRequestId) {
    const row = document.querySelector(`[data-request-row="${highlightRequestId}"]`);
    if (row) row.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    setTimeout(() => { highlightRequestId = null; }, 4000);
  }
}

function updatePreview() {
  const form = document.getElementById('requestform'), box = document.getElementById('requestpreview'); if (!form || !box) return;
  const personId = form.elements.person.value, start = form.elements.start.value, end = form.elements.end.value, portion = Number(form.elements.portion.value), type = form.elements.type.value;
  const days = businessDays(start, end) * portion, balance = remaining(personId, requests), burnsBalance = type === 'Vacation', isRemote = type === 'Work From Home', risk = coverageFor(start, end, requests, isRemote ? null : personId, modal?.id).filter(d => d.conflict);
  const pendingOther = requests.filter(r => r.id !== modal?.id && r.person === personId && r.status === 'pending' && +r.start.slice(0, 4) === new Date().getFullYear()).reduce((n, r) => n + balanceDuration(r), 0);
  box.innerHTML = `<div class="previewline"><span>Weekdays requested</span><b>${daysLabel(days)}</b></div><div class="previewline"><span>Already pending</span><b>${daysLabel(pendingOther)}</b></div><div class="previewline"><span>Balance after approval</span><b>${burnsBalance ? balance.available - days : balance.available} days</b></div><div class="previewline"><span>Team coverage</span><b class="${risk.length ? 'dangertext' : ''}">${isRemote ? '✓ Working remotely' : risk.length ? `⚠ ${daysLabel(risk.length)} below minimum` : '✓ No conflict found'}</b></div>`;
}
function toast(message) { const el = document.getElementById('toast'); if (!el) return; el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 3500); }
function setError(message) { const el = document.getElementById('formerror'); if (el) el.textContent = message; }
function download(name, text, type) { const url = URL.createObjectURL(new Blob([text], {type})), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportCsv() { const q = v => `"${String(v ?? '').replaceAll('"', '""')}"`, rows = [['Employee','Email','Team','Type','Start','End','Days','Status','Submitted'], ...requests.map(r => { const p = person(r.person); return [p?.name, p?.email, p?.team, r.type, r.start, r.end, requestDuration(r), r.status, r.submitted]; })]; download('team-leave-report.csv', rows.map(row => row.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); }
function exportIcs() { const compact = s => s.replaceAll('-', ''), events = requests.filter(r => r.status === 'approved').map(r => { const p = person(r.person), end = compact(iso(addDays(parseDate(r.end), 1))); return `BEGIN:VEVENT\r\nUID:${r.id}@teamleave\r\nDTSTART;VALUE=DATE:${compact(r.start)}\r\nDTEND;VALUE=DATE:${end}\r\nSUMMARY:${p?.name} — ${typeLabel(r)}\r\nEND:VEVENT`; }); download('team-leave-calendar.ics', `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Team Leave//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`, 'text/calendar;charset=utf-8'); }

app.addEventListener('click', async e => {
  const authTab = e.target.closest('[data-auth-mode]');
  if (authTab) {
    authMode = authTab.dataset.authMode;
    // Leaving a broken recovery link for Forgot / Sign in / Create password.
    if (passwordRecovery || hasRecoveryIntent()) {
      passwordRecovery = false;
      recoveryError = '';
      clearRecoveryIntent();
      scrubAuthParamsFromUrl();
      if (session) { stopLive(); await supabase.auth.signOut(); session = null; }
    }
    render();
    return;
  }
  const copy = e.target.closest('[data-copy-invite]'); if (copy) { await navigator.clipboard.writeText(decodeURIComponent(copy.dataset.copyInvite)); toast('Access details copied.'); return; }
  const openNotice = e.target.closest('[data-open-notice]');
  if (openNotice) {
    const requestId = openNotice.dataset.request;
    const n = notifications.find(x => x.id === openNotice.dataset.openNotice);
    if (n) n.read = true;
    await supabase.rpc('mark_notifications_read').catch(() => {});
    if (requestId) {
      const r = requests.find(x => x.id === requestId);
      if (r) {
        highlightRequestId = r.id;
        view = 'requests';
        if (isManagerRole() && r.person !== me && r.status === 'pending' && managesPerson(mePerson(), person(r.person))) {
          openModal({kind:'review', id:r.id});
        } else if (r.person === me && r.status === 'pending') {
          openModal({kind:'editrequest', id:r.id});
        } else {
          modal = null;
          requestFilter = r.status === 'pending' ? 'pending' : 'all';
          render();
        }
        return;
      }
    }
    modal = null;
    view = 'requests';
    render();
    return;
  }
  const resend = e.target.closest('[data-resendinvite]');
  if (resend && isAdmin()) {
    const p = person(resend.dataset.resendinvite);
    if (p?.email) openModal({kind:'invite', email:p.email});
    return;
  }
  const userFilterBtn = e.target.closest('[data-userfilter]');
  if (userFilterBtn) { userListFilter = userFilterBtn.dataset.userfilter; render(); return; }
  const nav = e.target.closest('[data-view]'); if (nav) { if (nav.dataset.view === 'users' && !isAdmin()) { toast('Only admins can manage users.'); return; } view = nav.dataset.view; modal = null; render(); return; }
  const filter = e.target.closest('[data-filter]'); if (filter) { requestFilter = filter.dataset.filter; render(); return; }

  const edit = e.target.closest('[data-edituser]'); if (edit && isAdmin()) { openModal({kind:'edituser', id:edit.dataset.edituser}); return; }
  const editRequest = e.target.closest('[data-editrequest]'); if (editRequest) { const r = requests.find(x => x.id === editRequest.dataset.editrequest); if (r?.person === me && r.status === 'pending') openModal({kind:'editrequest', id:r.id}); return; }
  const review = e.target.closest('[data-review]'); if (review) { if (!isManagerRole()) return; const r = requests.find(x => x.id === review.dataset.review); if (!r || !managesPerson(mePerson(), person(r.person))) { toast('You can only decide requests for your team.'); return; } openModal({kind:'review', id:review.dataset.review}); return; }
  const cancel = e.target.closest('[data-cancel]'); if (cancel) {
    const r = requests.find(x => x.id === cancel.dataset.cancel);
    if (r?.person === me && r.status === 'pending') {
      if (!confirm('Cancel this leave request? This cannot be undone from the app.')) return;
      try { await save('/api/requests/' + encodeURIComponent(r.id) + '/cancel', {}); render(); toast('Request cancelled.'); } catch (err) { toast(err.message); }
    }
    return;
  }
  const delHoliday = e.target.closest('[data-deleteholiday]'); if (delHoliday && isManagerRole()) {
    if (!confirm(`Delete holiday on ${delHoliday.dataset.deleteholiday}?`)) return;
    try { await save('/api/holidays-delete', {date: delHoliday.dataset.deleteholiday}); openModal({kind:'manageholidays'}); toast('Holiday deleted.'); } catch (err) { toast(err.message); }
    return;
  }
  const editHoliday = e.target.closest('[data-editholiday]'); if (editHoliday && isManagerRole()) { openModal({kind:'editholiday', date:editHoliday.dataset.editholiday}); return; }
  const date = e.target.closest('[data-date]'); if (date) { selectedDay = date.dataset.date; month = new Date(parseDate(selectedDay).getFullYear(), parseDate(selectedDay).getMonth(), 1); render(); return; }
  const button = e.target.closest('[data-action]'); if (!button) return;
  if (button.dataset.action === 'close') { if (e.target === button || button.tagName === 'BUTTON') closeModal(); return; }
  if (button.dataset.action === 'enterworkspace') {
    passwordSavedOk = false;
    if (!loadError) startLive();
    render();
    return;
  }
  if (button.dataset.action === 'help') { openModal({kind:'help'}); return; }
  if (button.dataset.action === 'signout') {
    passwordRecovery = false;
    recoveryError = '';
    passwordSavedOk = false;
    clearRecoveryIntent();
    stopLive();
    await supabase.auth.signOut();
    session = null;
    loadError = '';
    authMode = 'signin';
    render();
    return;
  }
  if (button.dataset.action === 'cancelrecovery') {
    passwordRecovery = false;
    recoveryError = '';
    clearRecoveryIntent();
    stopLive();
    await supabase.auth.signOut();
    session = null;
    loadError = '';
    authMode = 'signin';
    scrubAuthParamsFromUrl();
    render();
    return;
  }
  if (button.dataset.action === 'new') { openModal({kind:'new'}); return; }
  if (button.dataset.action === 'notifications') {
    openModal({kind:'notifications'});
    await supabase.rpc('mark_notifications_read');
    notifications.forEach(n => { n.read = true; });
    render(); // re-draw badge after mark-read while modal stays open
    return;
  }
  if (button.dataset.action === 'exportcsv') { exportCsv(); return; }
  if (button.dataset.action === 'exportics') { exportIcs(); return; }
  if (button.dataset.action === 'addholiday' && isManagerRole()) { openModal({kind:'addholiday'}); return; }
  if (button.dataset.action === 'manageholidays' && isManagerRole()) { openModal({kind:'manageholidays'}); return; }
  if (button.dataset.action === 'loadontario' && isManagerRole()) {
    const y = Number(button.dataset.year);
    try {
      for (const h of ontarioHolidays(y)) {
        const {error} = await supabase.rpc('upsert_holiday', {p_date:h.date, p_name:h.name, p_region:'Ontario'});
        if (error) throw Error(formatRpcError(error.message));
      }
      await loadState();
      openModal({kind:'manageholidays'});
      toast(`Ontario holidays for ${y} loaded.`);
    } catch (err) { toast(err.message); }
    return;
  }
  if (button.dataset.action === 'rollover' && isManagerRole()) {
    const pendingVacation = teamRequests().filter(r => r.status === 'pending' && r.type === 'Vacation');
    if (pendingVacation.length) {
      if (!confirm(`There ${pendingVacation.length === 1 ? 'is still 1 pending Vacation request' : `are still ${pendingVacation.length} pending Vacation requests`}. Decide them first if possible. Reset carry-in anyway?`)) return;
    } else if (!confirm('Reset carry-in (profiles.used) to 0 for your team? Carry-over policy is 0 — unused vacation does not roll forward. Approved leave history is kept.')) {
      return;
    }
    try { await save('/api/rollover', {}); render(); toast('Carry-in reset for your team.'); } catch (err) { toast(err.message); }
    return;
  }
  if (button.dataset.action === 'queue') { view = 'requests'; render(); return; }
  if (button.dataset.action === 'adduser' && isAdmin()) { openModal({kind:'adduser'}); return; }
  if (button.dataset.action === 'resetpassword' && isAdmin() && modal?.kind === 'edituser') {
    const p = person(modal.id);
    if (!p?.email) { setError('This user has no email on file.'); return; }
    if (p.active === false) { setError('Reactivate the user before sending a password reset link.'); return; }
    openModal({kind:'resetconfirm', id: modal.id});
    return;
  }
  if (button.dataset.action === 'backtoedituser' && isAdmin() && modal?.kind === 'resetconfirm') {
    openModal({kind:'edituser', id: modal.id});
    return;
  }
  if (button.dataset.action === 'confirmreset' && isAdmin() && modal?.kind === 'resetconfirm') {
    const p = person(modal.id);
    if (!p?.email) { setError('This user has no email on file.'); return; }
    if (p.active === false) { setError('Reactivate the user before sending a password reset link.'); return; }
    setError('');
    button.disabled = true;
    try {
      // Do not markRecoveryIntent here — the employee opens the email on their own device.
      const {error} = await supabase.auth.resetPasswordForEmail(p.email, {redirectTo: appRedirectUrl()});
      if (error) throw Error(error.message);
      openModal({kind:'edituser', id: p.id, resetSent: true});
      toast('Password reset email sent.');
    } catch (err) {
      openModal({kind:'edituser', id: p.id, resetError: err.message || 'Could not send reset email. Check Auth redirect URLs in Supabase.'});
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (button.dataset.action === 'password') { openModal({kind:'password'}); return; }
  if (button.dataset.action === 'prevmonth' || button.dataset.action === 'nextmonth') { month = new Date(month.getFullYear(), month.getMonth() + (button.dataset.action === 'prevmonth' ? -1 : 1), 1); selectedDay = iso(month); render(); return; }
  if (button.dataset.action === 'today') { month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); selectedDay = iso(new Date()); render(); }
});

app.addEventListener('input', e => {
  if (e.target.closest('#requestform')) { updatePreview(); setError(''); }
  if (e.target.id === 'usersearch') {
    userSearch = e.target.value;
    // Re-render list without losing focus: update only userlist when possible
    const panel = e.target.closest('.userspanel');
    if (!panel) { render(); return; }
    // Debounced light re-render of users page
    clearTimeout(app._userSearchTimer);
    app._userSearchTimer = setTimeout(() => {
      const active = document.activeElement === e.target;
      const pos = e.target.selectionStart;
      render();
      const input = document.getElementById('usersearch');
      if (active && input) { input.focus(); input.setSelectionRange(pos, pos); }
    }, 120);
  }
});
app.addEventListener('change', e => {
  const f = e.target.closest('#requestform');
  if (f) { if (e.target.name === 'portion' && e.target.value === '0.5') f.elements.end.value = f.elements.start.value; updatePreview(); }
  if (e.target.id === 'overrideCoverage') { const btn = document.getElementById('approveBtn'); if (btn) btn.disabled = !e.target.checked; setError(''); }
});

app.addEventListener('submit', async e => {
  if (e.target.id === 'loginform') {
    e.preventDefault(); const f = e.target, email = f.elements.email.value.trim().toLowerCase(); setError('');
    if (authMode === 'forgot') {
      const {data:invited, error:inviteError} = await supabase.rpc('is_invited_email', {p_email:email});
      if (inviteError) { setError(formatRpcError(inviteError.message)); return; }
      if (!invited) {
        setError('This email is not an active team member. Ask an admin to add (or reactivate) you. If you were just invited, use Create password — not Forgot password.');
        return;
      }
      markRecoveryIntent();
      const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo: appRedirectUrl()});
      if (error) { clearRecoveryIntent(); setError(error.message); return; }
      f.innerHTML = `<div class="okbox" role="status"><b>Check your email</b><p>If this address already has a Team Leave password, a reset link is on its way (check spam). Open the link to set a new password on this site.</p><p>Never created a password? Use <button type="button" class="loginlink inline" data-auth-mode="signup">Create password</button> instead — reset only works after the first password exists.</p></div>`;
      return;
    }
    const password = f.elements.password.value;
    if (authMode === 'signup') {
      if (password !== f.elements.confirmPassword.value) { setError('Passwords do not match.'); return; }
      const {data:invited, error:inviteError} = await supabase.rpc('is_invited_email', {p_email:email});
      if (inviteError) { setError(formatRpcError(inviteError.message)); return; }
      if (!invited) { setError('This email is not on the team yet. Ask an admin to add you first.'); return; }
    }
    const result = authMode === 'signup' ? await supabase.auth.signUp({email, password}) : await supabase.auth.signInWithPassword({email, password});
    if (result.error) { setError(result.error.message); return; }
    if (authMode === 'signup' && !result.data.session) { f.innerHTML = '<div class="okbox">Password created. If email confirmation is enabled, check your inbox before signing in.</div>'; return; }
    session = result.data.session; loadError = ''; passwordRecovery = false; recoveryError = ''; clearRecoveryIntent();
    if (session) { try { await loadState(); startLive(); } catch (err) { loadError = err.message; } }
    render(); return;
  }
  if (e.target.id === 'recoveryform') {
    e.preventDefault();
    const f = e.target, password = f.elements.password.value;
    if (password !== f.elements.confirmPassword.value) { setError('Passwords do not match.'); return; }
    setError('');
    const {error} = await supabase.auth.updateUser({password});
    if (error) { setError(error.message); return; }
    passwordRecovery = false;
    recoveryError = '';
    clearRecoveryIntent();
    scrubAuthParamsFromUrl();
    loadError = '';
    try { await loadState(); }
    catch (err) { loadError = err.message; }
    passwordSavedOk = true;
    render();
    return;
  }
  if (e.target.id === 'passwordform') { e.preventDefault(); const f = e.target, password = f.elements.password.value; if (password !== f.elements.confirmPassword.value) { setError('Passwords do not match.'); return; } const {error} = await supabase.auth.updateUser({password}); if (error) setError(error.message); else { closeModal(); toast('Password updated.'); } return; }
  if (e.target.id === 'edituserform') {
    e.preventDefault(); const f = e.target;
    const makingInactive = !f.elements.active.checked;
    const nextRole = f.elements.role.value;
    const target = person(modal.id);
    if (makingInactive || nextRole !== 'admin') {
      const otherAdmins = people.filter(p => p.id !== modal.id && p.role === 'admin' && p.active !== false);
      if (target?.role === 'admin' && target.active !== false && !otherAdmins.length) {
        setError('You cannot remove or deactivate the last active admin.');
        return;
      }
    }
    if (makingInactive && modal.id === me) {
      if (!confirm('Deactivate your own account? You will lose access until another admin reactivates you.')) return;
    } else if (makingInactive && target?.role === 'admin') {
      if (!confirm(`Deactivate admin ${target.name}? They will lose access until reactivated.`)) return;
    }
    try {
      await save('/api/people/' + encodeURIComponent(modal.id), {
        name: f.elements.name.value,
        allowance: Number(f.elements.allowance.value),
        used: Number(f.elements.used.value),
        role: nextRole,
        team: f.elements.team.value,
        managerEmail: f.elements.managerEmail.value.trim(),
        active: f.elements.active.checked
      });
      closeModal(); toast('User updated.');
    } catch (err) { setError(err.message); }
    return;
  }
  if (e.target.id === 'teamform') { e.preventDefault(); const f = e.target, email = f.elements.email.value.trim().toLowerCase(); try { await save('/api/people', {name:f.elements.name.value, email, allowance:Number(f.elements.allowance.value), team:f.elements.team.value, managerEmail:f.elements.managerEmail.value.trim()}); openModal({kind:'invite', email}); } catch (err) { setError(err.message); } return; }
  if (e.target.id === 'holidayform') { e.preventDefault(); const f = e.target; try { await save('/api/holidays', {date:f.elements.date.value, name:f.elements.name.value.trim()}); openModal({kind:'manageholidays'}); toast('Holiday saved.'); } catch (err) { setError(err.message); } return; }
  if (e.target.id === 'coverageform') {
    e.preventDefault();
    const raw = e.target.elements.minimum.value.trim();
    const minimum = raw === '' ? null : Number(raw);
    try { await save('/api/coverage', {minimum}); render(); toast('Coverage minimum updated.'); } catch (err) { toast(err.message); }
    return;
  }
  if (e.target.id === 'requestform') {
    e.preventDefault(); const f = e.target, personId = f.elements.person.value, start = f.elements.start.value, end = f.elements.end.value, portion = Number(f.elements.portion.value), type = f.elements.type.value, editing = modal.kind === 'editrequest';
    const error = portion === 0.5 && start !== end ? 'Half-day requests must start and end on the same date.' : validateRequest({person:personId, start, end, type, portion, excludeId:editing ? modal.id : null}, requests);
    if (error) { setError(error); return; }
    try {
      const editId = editing ? modal.id : null;
      await save(editing ? '/api/requests/' + encodeURIComponent(modal.id) : '/api/requests', {person:personId, start, end, note:f.elements.note.value.trim(), type, portion});
      // Highlight the submitted/updated request (match by dates+person if new).
      const match = editId
        ? requests.find(r => r.id === editId)
        : requests.find(r => r.person === personId && r.start === start && r.end === end && r.status === 'pending');
      highlightRequestId = match?.id || null;
      modal = null; view = 'requests'; render(); toast(editing ? 'Request updated.' : 'Request submitted for manager review.');
    } catch (err) { setError(err.message); }
    return;
  }
  if (e.target.id === 'decisionform') {
    e.preventDefault(); const f = e.target, decision = e.submitter?.value, r = requests.find(x => x.id === modal.id), note = f.elements.decisionNote.value.trim();
    if (!r || r.status !== 'pending' || !isManagerRole()) return;
    if (!managesPerson(mePerson(), person(r.person))) { setError('You can only decide requests for your team.'); return; }
    if (decision === 'declined' && !note) { setError('Add a short reason before declining.'); return; }
    if (decision === 'approved' && riskFor(r).length && !f.elements.override?.checked) { setError('Confirm that coverage is arranged before approving this conflict.'); return; }
    if (decision === 'approved' && riskFor(r).length && f.elements.override?.checked && !note) { setError('Add one sentence explaining how coverage is arranged.'); return; }
    if (decision === 'approved') {
      const bal = remaining(r.person, requests);
      const pendingOther = requests.filter(x => x.id !== r.id && x.person === r.person && x.status === 'pending' && +x.start.slice(0, 4) === new Date().getFullYear()).reduce((n, x) => n + balanceDuration(x), 0);
      if (balanceDuration(r) > bal.available - pendingOther) { setError('This employee no longer has enough available days.'); return; }
    }
    try { await save('/api/requests/' + encodeURIComponent(r.id) + '/decision', {decision, note, override:!!f.elements.override?.checked}); closeModal(); toast(`Request ${decision}.`); } catch (err) { setError(err.message); }
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !passwordRecovery) closeModal(); });
load();
supabase.auth.onAuthStateChange(async (event, next) => {
  if (event === 'PASSWORD_RECOVERY') {
    passwordRecovery = true;
    recoveryError = '';
    modal = null;
    session = next;
    loadError = '';
    if (session) {
      try { await loadState(); loadError = ''; }
      catch (e) { loadError = e.message; }
    }
    scrubAuthParamsFromUrl();
    loading = false;
    render();
    return;
  }
  // Same token — ignore (do NOT clear passwordRecovery on transient null sessions).
  if (next?.access_token === session?.access_token) return;
  // SIGNED_IN after a reset link: still force set-password UI when intent is present.
  if (event === 'SIGNED_IN' && next && (passwordRecovery || hasRecoveryIntent() || parseAuthUrl().looksRecovery)) {
    passwordRecovery = true;
    session = next;
    recoveryError = '';
    loadError = '';
    try { await loadState(); loadError = ''; } catch (e) { loadError = e.message; }
    scrubAuthParamsFromUrl();
    loading = false;
    render();
    return;
  }
  if (event === 'SIGNED_OUT') {
    session = null;
    stopLive();
    // Keep recovery UI if the URL still says reset (user landed without tokens).
    if (!hasRecoveryIntent()) {
      passwordRecovery = false;
      recoveryError = '';
    }
    render();
    return;
  }
  session = next; loadError = '';
  if (session && !passwordRecovery) { try { await loadState(); startLive(); } catch (e) { loadError = e.message; } }
  else if (!session) stopLive();
  render();
});
