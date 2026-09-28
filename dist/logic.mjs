export const people = [];
export let minimumCoverage = 1;
export const holidays = [];
export function setTeam(list, minimum) { people.splice(0,people.length,...list.map(p=>({...p,initials:p.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase(),color:'#d6e3ff'}))); minimumCoverage=minimum; }
export function setHolidays(list) { holidays.splice(0,holidays.length,...list.map(h=>h.date)); }
export const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const parseDate = s => new Date(`${s}T12:00:00`);
export const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate()+n); return d; };
export function addBusinessDays(date, n) {
  let d = new Date(date), moved = 0;
  while (moved < n) { d = addDays(d, 1); if (d.getDay() !== 0 && d.getDay() !== 6) moved++; }
  return d;
}
export function businessDates(start, end) {
  if (!start || !end || start > end) return [];
  const days = [], last = parseDate(end);
  for (let d = parseDate(start); d <= last; d = addDays(d, 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6 && !holidays.includes(iso(d))) days.push(iso(d));
    if (days.length > 370) break;
  }
  return days;
}
export const businessDays = (start, end) => businessDates(start, end).length;
export const requestDuration = r => businessDays(r.start,r.end)*(Number(r.portion)||1);
// Only Vacation burns annual vacation days. profiles.used is carry-in / manual only.
export const balanceDuration = r => r.type==='Vacation'?requestDuration(r):0;
export function sampleRequests(today = new Date()) {
  const day = n => iso(addBusinessDays(today,n));
  return [
    { id:'r1', person:'maya', start:day(3), end:day(5), type:'Vacation', status:'approved', note:'Family time', decisionNote:'', submitted:iso(today) },
    { id:'r2', person:'noah', start:day(4), end:day(5), type:'Vacation', status:'approved', note:'', decisionNote:'', submitted:iso(today) },
    { id:'r3', person:'alex', start:day(4), end:day(5), type:'Vacation', status:'pending', note:'A short break', decisionNote:'', submitted:iso(today) },
    { id:'r4', person:'alex', start:day(13), end:day(15), type:'Vacation', status:'approved', note:'', decisionNote:'', submitted:iso(today) },
    { id:'r5', person:'oliver', start:day(9), end:day(11), type:'Vacation', status:'pending', note:'', decisionNote:'', submitted:iso(today) },
    { id:'r6', person:'priya', start:day(17), end:day(18), type:'Vacation', status:'approved', note:'', decisionNote:'', submitted:iso(today) }
  ];
}
export function remaining(personId, requests) {
  const person = people.find(p=>p.id===personId);
  if (!person) return {allowance:0,used:0,approved:0,pending:0,available:0};
  const currentYear = new Date().getFullYear();
  const approved = requests.filter(r=>r.person===personId && r.status==='approved' && +r.start.slice(0,4)===currentYear).reduce((n,r)=>n+balanceDuration(r),0);
  const pending = requests.filter(r=>r.person===personId && r.status==='pending' && +r.start.slice(0,4)===currentYear).reduce((n,r)=>n+balanceDuration(r),0);
  // available = allowance − carry-in − approved Vacation (pending shown separately)
  return { allowance:person.allowance, used:person.used, approved, pending, available:person.allowance-person.used-approved };
}
export function coverageFor(start, end, requests, candidatePerson = null, excludedId = null) {
  return businessDates(start,end).map(date=>{
    const approved = new Set(requests.filter(r=>r.status==='approved' && r.type!=='Work From Home' && r.id!==excludedId && r.start<=date && r.end>=date).map(r=>r.person));
    const pending = new Set(requests.filter(r=>r.status==='pending' && r.id!==excludedId && r.start<=date && r.end>=date).map(r=>r.person));
    if (candidatePerson) { approved.add(candidatePerson); pending.delete(candidatePerson); }
    const available = people.length-approved.size;
    return { date, approved:[...approved], pending:[...pending], available, conflict:available<minimumCoverage };
  });
}
export function validateRequest({start,end,person,type='Vacation',portion=1,excludeId=null}, requests, today=new Date()) {
  if (!start || !end) return 'Choose a start and end date.';
  if (end<start) return 'The end date must be on or after the start date.';
  if (start<iso(today)) return 'Choose a future date or today.';
  if (start.slice(0,4)!==end.slice(0,4) || +start.slice(0,4)!==today.getFullYear()) return 'Keep this request within the current leave year.';
  const days = businessDays(start,end)*Number(portion);
  if (!days) return 'Select at least one weekday.';
  if (requests.some(r=>r.id!==excludeId && r.person===person && r.status!=='declined' && r.status!=='cancelled' && r.start<=end && r.end>=start)) return 'You already have a request on these dates.';
  if (type==='Vacation') {
    const bal = remaining(person,requests);
    const pendingOther = requests.filter(r=>r.id!==excludeId && r.person===person && r.status==='pending' && +r.start.slice(0,4)===today.getFullYear()).reduce((n,r)=>n+balanceDuration(r),0);
    if (days > bal.available - pendingOther) return 'This request exceeds the available balance.';
  }
  return null;
}
