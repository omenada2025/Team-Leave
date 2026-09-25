import {people, minimumCoverage, iso, parseDate, addBusinessDays, addDays, businessDays, setTeam, remaining, coverageFor, validateRequest} from './logic.mjs';

let requests = [];
let me = null;
let loading = true;
let loadError = '';
let role = 'employee', view = 'overview', modal = null;
let month = new Date(new Date().getFullYear(),new Date().getMonth(),1);
let selectedDay = iso(new Date());
const app = document.getElementById('app');
const person = id => people.find(p=>p.id===id);
const escapeHtml = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = s => parseDate(s).toLocaleDateString('en-CA',{month:'short',day:'numeric'});
const longDate = s => parseDate(s).toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
const range = r => `${pretty(r.start)}${r.start===r.end?'':` – ${pretty(r.end)}`}`;
const daysLabel = n => `${n} ${n===1?'day':'days'}`;
const save = async (path, data) => { const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to save.');hydrate(payload); };
function hydrate(data) { setTeam(data.people,data.minimumCoverage); requests=data.requests;me=data.me;role=data.role; }
async function load() { try { const response=await fetch('/api/state');const data=await response.json();if(!response.ok)throw Error(data.error);hydrate(data);loading=false;render(); } catch(e) { loading=false;loadError=e.message;render(); } }
const mine = () => people.find(p=>p.id===me) || people[0];
const avatar = (p,small=false) => `<span class="avatar ${small?'small':''}" style="--avatar:${p.color}">${p.initials}</span>`;
const badge = status => `<span class="badge ${status}"><i></i>${status[0].toUpperCase()+status.slice(1)}</span>`;
const icon = name => ({overview:'◫',requests:'▤',calendar:'▦',users:'♙'}[name]);
const riskFor = r => coverageFor(r.start,r.end,requests,r.person,r.id).filter(d=>d.conflict);
const requestOrder = (a,b) => (a.status==='pending'?0:1)-(b.status==='pending'?0:1) || a.start.localeCompare(b.start);

function shell(content) {
  return `<div class="shell">
    <aside class="sidebar"><div class="brand"><span class="brandmark"><b></b><b></b><b></b><b></b></span><span>team<span class="brandlight">leave</span></span></div>
      <div class="navlabel">WORKSPACE</div><nav aria-label="Main navigation">
      ${['overview','requests','calendar','users'].map(v=>`<button class="navitem ${view===v?'active':''}" data-view="${v}" ${view===v?'aria-current="page"':''}><span class="navicon">${icon(v)}</span>${v==='calendar'?'Team calendar':v==='users'?'Users':v[0].toUpperCase()+v.slice(1)}${v==='requests'&&role==='manager'?`<span class="navcount">${requests.filter(r=>r.status==='pending').length}</span>`:''}</button>`).join('')}
      </nav><div class="sidebottom"><a class="textbtn" href="/signout-with-chatgpt?return_to=%2Flogin" target="_top">Sign out</a></div>
    </aside><div class="workspace"><header class="topbar"><div class="mobilebrand">team<span>leave</span></div><div class="breadcrumb">Workspace <span>/</span> ${view==='calendar'?'Team calendar':view==='users'?'Users':view[0].toUpperCase()+view.slice(1)}</div><div class="toptools"><span class="private"><span class="lock">●</span> Private team</span><span class="private">${escapeHtml(mine()?.name||'Team member')} · ${role}</span>${mine()?avatar(mine(),true):''}</div></header>
    <main class="main">${content}</main></div></div>${modal?renderModal():''}<div id="toast" role="status" aria-live="polite"></div>`;
}

function overview() {
  const balance = remaining(me,requests);
  const pending = requests.filter(r=>r.status==='pending');
  const soon = requests.filter(r=>r.status==='approved' && r.end>=iso(new Date())).sort((a,b)=>a.start.localeCompare(b.start)).slice(0,4);
  const risks = pending.map(r=>({r,days:riskFor(r)})).filter(x=>x.days.length);
  const awayNow = new Set(requests.filter(r=>r.status==='approved' && r.start<=iso(new Date()) && r.end>=iso(new Date())).map(r=>r.person)).size;
  return `<div class="pageheading"><div><div class="eyebrow">${role==='manager'?'TEAM OVERVIEW':'YOUR TIME OFF'}</div><h1>${role==='manager'?'A clearer view of time away.':'Make room for time away.'}</h1><p>${role==='manager'?'Review requests, protect coverage, and keep everyone in the loop.':'Your leave balance, requests, and team plans in one place.'}</p></div><button class="primary topaction" data-action="new">+ &nbsp;Request time off</button></div>
  <section class="hero"><div class="herotext"><span class="heroeyebrow">${role==='manager'?'TEAM LEAVE / '+new Date().getFullYear():'YOUR LEAVE / '+new Date().getFullYear()}</span><h2>${role==='manager'?'Plan together.<br>Stay covered.':'Time off looks<br>good on you.'}</h2><p>${role==='manager'?'The team’s next decisions and availability, at a glance.':'You have '+balance.available+' days available to plan this year.'}</p><button class="whitebutton" data-action="${role==='manager'?'queue':'new'}">${role==='manager'?'Review requests':'Plan time off'} <span>↗</span></button></div><div class="heroart"><div class="artcircle one"></div><div class="artcircle two"></div><div class="artcard"><div class="artrow"><span class="artsun">✳</span><span>TIME TO RESET</span></div><div class="artdays">${role==='manager'?pending.length:balance.available}<span>${role==='manager'?'to review':'days left'}</span></div><div class="artline"><span></span><span></span><span></span></div></div></div></section>
  <section class="stats" aria-label="At a glance"><div class="stat"><div class="stathead"><span>Available to use</span><span class="statglyph lavender">✳</span></div><strong>${balance.available}<small> days</small></strong><div class="statfoot">Your ${new Date().getFullYear()} vacation balance</div></div><div class="stat"><div class="stathead"><span>${role==='manager'?'Awaiting your review':'Your pending requests'}</span><span class="statglyph peach">◷</span></div><strong>${role==='manager'?pending.length:pending.filter(r=>r.person===me).length}<small> requests</small></strong><div class="statfoot">${role==='manager'?'Decision needed':'Waiting for manager approval'}</div></div><div class="stat"><div class="stathead"><span>Team away today</span><span class="statglyph mint">◉</span></div><strong>${awayNow}<small> people</small></strong><div class="statfoot">${people.length-awayNow} of ${people.length} available</div></div></section>
  <div class="overviewgrid"><section class="panel"><div class="sectionhead"><div><span class="eyebrow">COMING UP</span><h3>Upcoming absences</h3></div><button class="linkbutton" data-view="calendar">View calendar <span>→</span></button></div>${soon.length?`<div class="absence-list">${soon.map(r=>`<div class="absence">${avatar(person(r.person))}<div class="absenceperson"><b>${person(r.person).name}</b><span>Vacation · ${daysLabel(businessDays(r.start,r.end))}</span></div><time>${range(r)}</time></div>`).join('')}</div>`:'<div class="empty">No upcoming approved time off yet.</div>'}</section>
  <section class="panel coveragepanel"><div class="sectionhead"><div><span class="eyebrow">COVERAGE WATCH</span><h3>Needs a closer look</h3></div><span class="countpill">${risks.length} ${risks.length===1?'conflict':'conflicts'}</span></div>${risks.length?risks.slice(0,2).map(({r,days})=>`<div class="riskitem"><span class="riskicon">!</span><div><b>${person(r.person).name} · ${range(r)}</b><p>${daysLabel(days.length)} below ${minimumCoverage}-person minimum if approved. ${days[0].available} available on ${pretty(days[0].date)}.</p>${role==='manager'?`<button class="smalllink" data-review="${r.id}">Review request →</button>`:''}</div></div>`).join(''):'<div class="goodstate"><span>✓</span><div><b>Coverage looks healthy</b><p>No pending requests currently fall below your team minimum.</p></div></div>'}<div class="coveragefoot">Based on approved leave · minimum ${minimumCoverage} of ${people.length} available</div></section></div>`;
}

function requestRows(items, manager) {
  if (!items.length) return '<div class="empty">Nothing here yet. New requests will show up as soon as they are submitted.</div>';
  return `<div class="tablewrap"><table><thead><tr>${manager?'<th>Employee</th>':''}<th>Dates</th><th>Duration</th><th>Status</th>${manager?'<th>Coverage</th>':''}<th class="right">Action</th></tr></thead><tbody>${items.map(r=>{
    const risks = r.status==='pending'?riskFor(r):[];
    return `<tr>${manager?`<td><div class="cellperson">${avatar(person(r.person),true)}<b>${person(r.person).name}</b></div></td>`:''}<td><b>${range(r)}</b><span class="cellsub">${r.type}</span></td><td>${daysLabel(businessDays(r.start,r.end))}</td><td>${badge(r.status)}${r.decisionNote?`<span class="cellsub decisionnote">${escapeHtml(r.decisionNote)}</span>`:''}</td>${manager?`<td>${risks.length?`<span class="impact caution">⚠ ${daysLabel(risks.length)} at risk</span>`:'<span class="impact good">✓ Covered</span>'}</td>`:''}<td class="right">${manager&&r.status==='pending'?`<button class="rowaction" data-review="${r.id}">Review →</button>`:!manager&&r.status==='pending'?`<button class="rowaction muted" data-cancel="${r.id}">Cancel</button>`:'<span class="dash">—</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function requestsPage() {
  const list = role==='manager'?[...requests].sort(requestOrder):requests.filter(r=>r.person===me).sort(requestOrder);
  const pending = list.filter(r=>r.status==='pending').length;
  const b = remaining(me,requests);
  return `<div class="pageheading"><div><div class="eyebrow">${role==='manager'?'APPROVALS':'MY REQUESTS'}</div><h1>${role==='manager'?'Requests & decisions':'Your requests'}</h1><p>${role==='manager'?'Make decisions with leave balances and coverage in view.':'Submit time off and follow each request through to a decision.'}</p></div><button class="primary topaction" data-action="new">+ &nbsp;Request time off</button></div>
  ${role==='employee'?`<section class="balancebar"><div><span class="eyebrow">${new Date().getFullYear()} BALANCE</span><strong>${b.available} <small>days available</small></strong></div><div class="balanceitems"><span><b>${b.allowance}</b> annual</span><span><b>${b.used}</b> used</span><span><b>${b.approved}</b> approved ahead</span><span><b>${b.pending}</b> awaiting approval</span></div></section>`:`<div class="queueintro"><span class="queueicon">◷</span><div><b>${pending} ${pending===1?'request needs':'requests need'} a decision</b><span>Coverage warnings are based on approved leave and a ${minimumCoverage}-person minimum.</span></div></div>`}
  <section class="panel requestspanel"><div class="sectionhead"><div><span class="eyebrow">${role==='manager'?'TEAM':'HISTORY'}</span><h3>${role==='manager'?'All team requests':'All your requests'}</h3></div><span class="countpill">${list.length} total</span></div>${requestRows(list,role==='manager')}</section>`;
}

function calendarPage() {
  const year=month.getFullYear(), m=month.getMonth(), first=new Date(year,m,1), offset=(first.getDay()+6)%7;
  const length=new Date(year,m+1,0).getDate(), cells=Math.ceil((offset+length)/7)*7;
  const days=Array.from({length:cells},(_,i)=>addDays(first,i-offset));
  const scheduled = requests.filter(r=>r.status==='approved' && r.start<=iso(new Date(year,m+1,0)) && r.end>=iso(first));
  const chosen = requests.filter(r=>r.start<=selectedDay && r.end>=selectedDay && r.status==='approved');
  const pendingOnDay = requests.filter(r=>r.start<=selectedDay && r.end>=selectedDay && r.status==='pending');
  const availability = coverageFor(selectedDay,selectedDay,requests)[0];
  return `<div class="pageheading"><div><div class="eyebrow">TEAM AVAILABILITY</div><h1>Everyone, in the picture.</h1><p>Approved absences and pending plans in a single shared view.</p></div><button class="primary topaction" data-action="new">+ &nbsp;Request time off</button></div>
  <div class="calendargrid"><section class="panel calendarpanel"><div class="calendarhead"><div><span class="eyebrow">TEAM CALENDAR</span><h3>${month.toLocaleDateString('en-CA',{month:'long',year:'numeric'})}</h3></div><div class="monthbuttons"><button data-action="prevmonth" aria-label="Previous month">‹</button><button data-action="today">Today</button><button data-action="nextmonth" aria-label="Next month">›</button></div></div><div class="calweek">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<span>${x}</span>`).join('')}</div><div class="caldays">${days.map(d=>{
    const date=iso(d), active=d.getMonth()===m, events=requests.filter(r=>r.start<=date&&r.end>=date&&r.status==='approved'), waits=requests.filter(r=>r.start<=date&&r.end>=date&&r.status==='pending');
    return `<button class="calday ${active?'':'outside'} ${selectedDay===date?'chosen':''} ${date===iso(new Date())?'todaydate':''}" data-date="${date}" aria-label="${longDate(date)}, ${events.length} approved absences"><span class="daynum">${d.getDate()}</span><span class="calentries">${events.slice(0,2).map(r=>`<span class="calentry" style="--event:${person(r.person).color}">${person(r.person).name.split(' ')[0]}</span>`).join('')}${events.length>2?`<span class="moreevents">+${events.length-2} more</span>`:''}${waits.length?`<span class="pendingdot" title="${waits.length} pending">· ${waits.length} pending</span>`:''}</span></button>`;
  }).join('')}</div><div class="callegend"><span><i class="legendapproved"></i>Approved</span><span><i class="legendpending"></i>Pending</span></div></section>
  <aside class="panel daypanel"><span class="eyebrow">DAILY SNAPSHOT</span><h3>${longDate(selectedDay)}</h3><div class="coveragefigure"><strong>${availability?availability.available:people.length}<small> / ${people.length}</small></strong><span>available to work</span></div><div class="meter"><span style="width:${(availability?availability.available:people.length)/people.length*100}%"></span></div><p class="threshold ${availability?.conflict?'at-risk':''}">${availability?.conflict?'⚠ Below coverage minimum':`✓ Minimum ${minimumCoverage} people covered`}</p><div class="daydivider"></div><h4>Away that day <span>${chosen.length}</span></h4>${chosen.length?chosen.map(r=>`<div class="dayperson">${avatar(person(r.person),true)}<div><b>${person(r.person).name}</b><span>Vacation · ${range(r)}</span></div></div>`).join(''):'<p class="quiet">Nobody is away on approved leave.</p>'}${pendingOnDay.length?`<h4 class="pendingtitle">Pending <span>${pendingOnDay.length}</span></h4>${pendingOnDay.map(r=>`<div class="dayperson">${avatar(person(r.person),true)}<div><b>${person(r.person).name}</b><span>Awaiting approval</span></div></div>`).join('')}`:''}</aside></div>`;
}

function usersPage() {
  const minePerson=mine();
  return `<div class="pageheading"><div><div class="eyebrow">ACCOUNT & ACCESS</div><h1>${role==='manager'?'Team users':'Your account'}</h1><p>${role==='manager'?'Manage team roles and leave balances.':'Your profile and leave balance.'}</p></div>${role==='manager'?'<button class="primary topaction" data-action="adduser">+ Add user</button>':''}</div>
  <section class="panel userspanel"><div class="sectionhead"><div><span class="eyebrow">${role==='manager'?'TEAM DIRECTORY':'PROFILE'}</span><h3>${role==='manager'?`${people.length} users`:'Your details'}</h3></div></div>
  <div class="userlist">${(role==='manager'?people:[minePerson]).map(p=>`<div class="userrow">${avatar(p)}<div class="useridentity"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.email||'')}</span></div><span class="userrole">${p.role==='manager'?'Manager':'Employee'}</span><span class="userbalance"><b>${remaining(p.id,requests).available}</b> days available</span>${role==='manager'?`<button class="rowaction" data-edituser="${p.id}" aria-label="Edit ${escapeHtml(p.name)}">Edit</button>`:''}</div>`).join('')}</div></section>
  ${role==='manager'?'<p class="userhint">Adding a user creates their team profile. Grant the same email access in the private site sharing settings before they can sign in.</p>':'<p class="userhint">Your manager can update your allowance or role. Use Sign out when you finish.</p>'}`;
}

function renderModal() {
  if (modal.kind==='edituser') {
    const p=person(modal.id);if(!p)return '';
    return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">USER DETAILS</div><h2 id="dialog-title">Edit ${escapeHtml(p.name)}</h2><p class="dialoglead">${escapeHtml(p.email)}</p><form id="edituserform"><label>Name<input name="name" maxlength="100" value="${escapeHtml(p.name)}" required></label><div class="formrow"><label>Annual allowance<input name="allowance" type="number" min="0" max="100" value="${p.allowance}" required></label><label>Days already used<input name="used" type="number" min="0" max="100" value="${p.used}" required></label></div><label>Role<select name="role"><option value="employee" ${p.role==='employee'?'selected':''}>Employee</option><option value="manager" ${p.role==='manager'?'selected':''}>Manager</option></select></label><p class="quiet">Changing the balance affects future request checks. Approved requests are counted separately.</p><div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button class="secondary" type="button" data-action="close">Cancel</button><button class="primary" type="submit">Save changes</button></div></form></div></div>`;
  }
  if (modal.kind==='adduser') return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">NEW USER</div><h2 id="dialog-title">Add user</h2><p class="dialoglead">Create a team profile for an invited colleague.</p><form id="teamform"><label>Name<input name="name" maxlength="100" required></label><label>Email<input name="email" type="email" required></label><label>Annual vacation days<input name="allowance" type="number" min="0" max="100" value="25" required></label><div id="formerror" role="alert" class="formerror"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button class="primary" type="submit">Add user</button></div></form></div></div>`;
  if (modal.kind==='new') {
    const start=iso(addBusinessDays(new Date(),7)), end=iso(addBusinessDays(new Date(),8));
    return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">NEW REQUEST</div><h2 id="dialog-title">Request time off</h2><p class="dialoglead">Plan your dates. Your manager will see any coverage concerns before deciding.</p><form id="requestform"><label>Employee<select name="person" ${role==='employee'?'disabled':''}>${people.map(p=>`<option value="${p.id}" ${p.id===me?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select></label><div class="formrow"><label>Start date<input name="start" type="date" min="${iso(new Date())}" value="${start}" required></label><label>End date<input name="end" type="date" min="${iso(new Date())}" value="${end}" required></label></div><label>Note for manager <span class="optional">Optional</span><textarea name="note" maxlength="500" placeholder="Anything helpful for planning coverage"></textarea></label><div id="requestpreview" class="requestpreview"></div><div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" class="primary">Submit request →</button></div></form></div></div>`;
  }
  const r=requests.find(x=>x.id===modal.id); if(!r) return '';
  const risk=riskFor(r), b=remaining(r.person,requests);
  return `<div class="scrim" data-action="close"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialogclose" data-action="close" aria-label="Close">×</button><div class="eyebrow">MANAGER DECISION</div><h2 id="dialog-title">Review time off</h2><div class="reviewperson">${avatar(person(r.person))}<div><b>${person(r.person).name}</b><span>${range(r)} · ${daysLabel(businessDays(r.start,r.end))}</span></div>${badge(r.status)}</div><div class="reviewfacts"><div><span>Balance after approval</span><b>${b.available-businessDays(r.start,r.end)} days</b></div><div><span>Coverage impact</span><b class="${risk.length?'dangertext':''}">${risk.length?`${daysLabel(risk.length)} below minimum`:'No conflict'}</b></div></div>${risk.length?`<div class="warnbox"><b>⚠ Coverage conflict</b><p>Approving this request leaves ${risk[0].available} of ${people.length} people available on ${risk.map(x=>pretty(x.date)).join(', ')}. Your minimum is ${minimumCoverage}.</p></div>`:'<div class="okbox">✓ Team coverage meets the minimum for these dates.</div>'}${r.note?`<div class="requestnote"><span>EMPLOYEE NOTE</span><p>${escapeHtml(r.note)}</p></div>`:''}<form id="decisionform"><label>Decision note <span class="optional">Required to decline</span><textarea name="decisionNote" maxlength="500" placeholder="Add context for the employee"></textarea></label>${risk.length?`<label class="checkline"><input type="checkbox" name="override"> I’ve arranged coverage and want to approve anyway.</label>`:''}<div id="formerror" class="formerror" role="alert"></div><div class="dialogactions"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" name="decision" value="declined" class="declinebutton">Decline</button><button type="submit" name="decision" value="approved" class="primary">Approve →</button></div></form></div></div>`;
}

function render() {
  if(loading){app.innerHTML='<main class="main"><h1>Loading team leave…</h1></main>';return;}
  if(loadError){app.innerHTML=`<main class="main"><h1>Unable to open Team Leave</h1><p>${escapeHtml(loadError)}</p><a href="/login">Go to sign in</a></main>`;return;}
  app.innerHTML=shell(view==='overview'?overview():view==='requests'?requestsPage():view==='users'?usersPage():calendarPage());
  if (modal?.kind==='new') updatePreview();
  if(modal) document.querySelector('.dialogclose')?.focus();
}
function updatePreview() {
  const form=document.getElementById('requestform'), box=document.getElementById('requestpreview'); if(!form||!box)return;
  const personId=form.elements.person.value, start=form.elements.start.value,end=form.elements.end.value;
  const days=businessDays(start,end), balance=remaining(personId,requests), risk=coverageFor(start,end,requests,personId).filter(d=>d.conflict);
  box.innerHTML=`<div class="previewline"><span>Weekdays requested</span><b>${daysLabel(days)}</b></div><div class="previewline"><span>Balance after approval</span><b>${balance.available-days} days</b></div><div class="previewline"><span>Team coverage</span><b class="${risk.length?'dangertext':''}">${risk.length?`⚠ ${daysLabel(risk.length)} below minimum`:'✓ No conflict found'}</b></div>`;
}
function toast(message) { const el=document.getElementById('toast'); if(!el)return; el.textContent=message; el.classList.add('visible'); setTimeout(()=>el.classList.remove('visible'),3500); }
function setError(message) { const el=document.getElementById('formerror'); if(el)el.textContent=message; }
app.addEventListener('click',async e=>{
  const nav=e.target.closest('[data-view]'); if(nav){view=nav.dataset.view;modal=null;render();return;}

  const edit=e.target.closest('[data-edituser]');if(edit&&role==='manager'){modal={kind:'edituser',id:edit.dataset.edituser};render();return;}
  const review=e.target.closest('[data-review]'); if(review){if(role!=='manager')return;modal={kind:'review',id:review.dataset.review};render();return;}
  const cancel=e.target.closest('[data-cancel]'); if(cancel){const r=requests.find(x=>x.id===cancel.dataset.cancel);if(r?.person===me&&r.status==='pending'){try{await save('/api/requests/'+encodeURIComponent(r.id)+'/cancel',{});render();toast('Request cancelled.');}catch(err){toast(err.message)}}return;}
  const date=e.target.closest('[data-date]'); if(date){selectedDay=date.dataset.date;month=new Date(parseDate(selectedDay).getFullYear(),parseDate(selectedDay).getMonth(),1);render();return;}
  const button=e.target.closest('[data-action]'); if(!button)return;
  if(button.dataset.action==='close'){if(e.target===button || button.tagName==='BUTTON'){modal=null;render();}return;}
  if(button.dataset.action==='new'){modal={kind:'new'};render();return;}
  if(button.dataset.action==='queue'){view='requests';render();return;}
  if(button.dataset.action==='adduser'&&role==='manager'){modal={kind:'adduser'};render();return;}
  if(button.dataset.action==='prevmonth'||button.dataset.action==='nextmonth'){month=new Date(month.getFullYear(),month.getMonth()+(button.dataset.action==='prevmonth'?-1:1),1);selectedDay=iso(month);render();return;}
  if(button.dataset.action==='today'){month=new Date(new Date().getFullYear(),new Date().getMonth(),1);selectedDay=iso(new Date());render();}
});
app.addEventListener('input',e=>{if(e.target.closest('#requestform')){updatePreview();setError('');}});
app.addEventListener('change',e=>{if(e.target.closest('#requestform'))updatePreview();});
app.addEventListener('submit',async e=>{
  if(e.target.id==='edituserform'){e.preventDefault();const f=e.target;try{await save('/api/people/'+encodeURIComponent(modal.id),{name:f.elements.name.value,allowance:Number(f.elements.allowance.value),used:Number(f.elements.used.value),role:f.elements.role.value});modal=null;render();toast('User updated.');}catch(err){setError(err.message)}return;}
  if(e.target.id==='teamform'){e.preventDefault();const f=e.target;try{await save('/api/people',{name:f.elements.name.value,email:f.elements.email.value,allowance:Number(f.elements.allowance.value)});modal=null;render();toast('Team member added. Invite this email to the private Site to grant access.');}catch(err){setError(err.message)}return;}
  if(e.target.id==='requestform'){
    e.preventDefault();const f=e.target, personId=f.elements.person.value,start=f.elements.start.value,end=f.elements.end.value;
    const error=validateRequest({person:personId,start,end},requests);if(error){setError(error);return;}
    try { await save('/api/requests',{person:personId,start,end,note:f.elements.note.value.trim()});modal=null;view='requests';render();toast('Request submitted for manager review.'); } catch(err){setError(err.message)}return;
  }
  if(e.target.id==='decisionform'){
    e.preventDefault();const f=e.target,decision=e.submitter?.value, r=requests.find(x=>x.id===modal.id),note=f.elements.decisionNote.value.trim();
    if(!r||r.status!=='pending'||role!=='manager')return;
    if(decision==='declined'&&!note){setError('Add a short reason before declining.');return;}
    if(decision==='approved'&&riskFor(r).length&&!f.elements.override?.checked){setError('Confirm that coverage is arranged before approving this conflict.');return;}
    if(decision==='approved'&&businessDays(r.start,r.end)>remaining(r.person,requests).available){setError('This employee no longer has enough available days.');return;}
    try{await save('/api/requests/'+encodeURIComponent(r.id)+'/decision',{decision,note,override:!!f.elements.override?.checked});modal=null;render();toast(`Request ${decision}.`)}catch(err){setError(err.message)}
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal){modal=null;render();}});
load();
