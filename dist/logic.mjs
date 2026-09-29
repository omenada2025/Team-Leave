export const people = [];
export let minimumCoverage = 1;
/** @type {string[]} ISO dates marked as holidays */
export const holidays = [];
/** @type {Record<string,string>} date → holiday name */
export const holidayNames = {};

export function activePeople() {
  return people.filter(p => p.active !== false);
}

/** Auto coverage floor when team_settings.minimum_coverage is null.
 *  Small teams (≤3): at most one person away → max(1, n − 1).
 *  Larger teams: max(1, n − 2). */
export function defaultCoverageMinimum(headcount) {
  const n = Math.max(0, Number(headcount) || 0);
  if (n <= 3) return Math.max(1, n - 1);
  return Math.max(1, n - 2);
}

/** Normalize DB date / timestamptz strings to YYYY-MM-DD for comparisons. */
export const dayKey = value => String(value || '').slice(0, 10);

export function setTeam(list, minimum) {
  people.splice(0, people.length, ...list.map(p => ({
    ...p,
    active: p.active !== false,
    initials: p.name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase(),
    color: '#d6e3ff'
  })));
  if (minimum != null && minimum > 0) minimumCoverage = minimum;
  else minimumCoverage = defaultCoverageMinimum(activePeople().length);
}

export function setHolidays(list) {
  holidays.splice(0, holidays.length);
  for (const key of Object.keys(holidayNames)) delete holidayNames[key];
  for (const h of list || []) {
    const date = typeof h === 'string' ? h : h.date;
    if (!date) continue;
    holidays.push(date);
    holidayNames[date] = (typeof h === 'string' ? 'Holiday' : (h.name || 'Holiday'));
  }
}

export const holidayName = date => holidayNames[date] || 'Holiday';

export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDate = s => new Date(`${s}T12:00:00`);
export const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

export function addBusinessDays(date, n) {
  let d = new Date(date), moved = 0;
  while (moved < n) {
    d = addDays(d, 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) moved++;
  }
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
export const requestDuration = r => businessDays(r.start, r.end) * (Number(r.portion) || 1);
// Only Vacation burns annual vacation days. profiles.used is carry-in / manual only.
export const balanceDuration = r => r.type === 'Vacation' ? requestDuration(r) : 0;

export function sampleRequests(today = new Date()) {
  const day = n => iso(addBusinessDays(today, n));
  return [
    { id: 'r1', person: 'maya', start: day(3), end: day(5), type: 'Vacation', status: 'approved', note: 'Family time', decisionNote: '', submitted: iso(today) },
    { id: 'r2', person: 'noah', start: day(4), end: day(5), type: 'Vacation', status: 'approved', note: '', decisionNote: '', submitted: iso(today) },
    { id: 'r3', person: 'alex', start: day(4), end: day(5), type: 'Vacation', status: 'pending', note: 'A short break', decisionNote: '', submitted: iso(today) },
    { id: 'r4', person: 'alex', start: day(13), end: day(15), type: 'Vacation', status: 'approved', note: '', decisionNote: '', submitted: iso(today) },
    { id: 'r5', person: 'oliver', start: day(9), end: day(11), type: 'Vacation', status: 'pending', note: '', decisionNote: '', submitted: iso(today) },
    { id: 'r6', person: 'priya', start: day(17), end: day(18), type: 'Vacation', status: 'approved', note: '', decisionNote: '', submitted: iso(today) }
  ];
}

export function remaining(personId, requests) {
  const person = people.find(p => p.id === personId);
  if (!person) return { allowance: 0, used: 0, approved: 0, pending: 0, available: 0 };
  const currentYear = new Date().getFullYear();
  const approved = requests.filter(r => r.person === personId && r.status === 'approved' && +r.start.slice(0, 4) === currentYear).reduce((n, r) => n + balanceDuration(r), 0);
  const pending = requests.filter(r => r.person === personId && r.status === 'pending' && +r.start.slice(0, 4) === currentYear).reduce((n, r) => n + balanceDuration(r), 0);
  // available = allowance − carry-in − approved Vacation (pending shown separately)
  return { allowance: person.allowance, used: person.used, approved, pending, available: person.allowance - person.used - approved };
}

export function coverageFor(start, end, requests, candidatePerson = null, excludedId = null) {
  const headcount = activePeople().length;
  const activeIds = new Set(activePeople().map(p => p.id));
  return businessDates(dayKey(start), dayKey(end)).map(date => {
    const approved = new Set();
    const pending = new Set();
    for (const r of requests || []) {
      if (!r || r.id === excludedId || r.type === 'Work From Home') continue;
      if (!activeIds.has(r.person)) continue;
      if (dayKey(r.start) > date || dayKey(r.end) < date) continue;
      if (r.status === 'approved') approved.add(r.person);
      else if (r.status === 'pending') pending.add(r.person);
    }
    // Pending + approved both reduce availability (WFH already skipped).
    const away = new Set([...approved, ...pending]);
    if (candidatePerson && activeIds.has(candidatePerson)) {
      away.add(candidatePerson);
      pending.delete(candidatePerson);
    }
    const available = headcount - away.size;
    return {
      date,
      approved: [...approved],
      pending: [...pending],
      available,
      conflict: available < minimumCoverage
    };
  });
}

/** True when the person already has pending/approved leave overlapping the range. */
export function hasOwnLeaveOverlap(personId, start, end, requests, excludeId = null) {
  const s = dayKey(start), e = dayKey(end);
  if (!personId || !s || !e || e < s) return false;
  return (requests || []).some(r =>
    r.id !== excludeId
    && r.person === personId
    && r.status !== 'declined'
    && r.status !== 'cancelled'
    && dayKey(r.start) <= e
    && dayKey(r.end) >= s
  );
}

/** Admin manages everyone except self. Manager: same team OR manager_email match. */
export function managesPerson(manager, employee) {
  if (!manager || !employee || manager.id === employee.id) return false;
  if (manager.role === 'admin') return true;
  if (manager.role !== 'manager') return false;
  const sameTeam = (employee.team || 'General') === (manager.team || 'General');
  const assigned = (employee.manager_email || '').toLowerCase() === (manager.email || '').toLowerCase();
  return sameTeam || assigned;
}

export function validateRequest({ start, end, person, type = 'Vacation', portion = 1, excludeId = null }, requests, today = new Date()) {
  const s = dayKey(start), e = dayKey(end);
  if (!s || !e) return 'Choose a start and end date.';
  if (e < s) return 'The end date must be on or after the start date.';
  if (s < iso(today)) return 'Choose a future date or today.';
  if (s.slice(0, 4) !== e.slice(0, 4) || +s.slice(0, 4) !== today.getFullYear()) return 'Keep this request within the current leave year.';
  const days = businessDays(s, e) * Number(portion);
  if (!days) return 'Select at least one weekday.';
  if (hasOwnLeaveOverlap(person, s, e, requests, excludeId)) return 'You already have a request on these dates.';
  if (type === 'Vacation') {
    const bal = remaining(person, requests);
    const pendingOther = requests.filter(r => r.id !== excludeId && r.person === person && r.status === 'pending' && +dayKey(r.start).slice(0, 4) === today.getFullYear()).reduce((n, r) => n + balanceDuration(r), 0);
    if (days > bal.available - pendingOther) return 'This request exceeds the available balance.';
  }
  return null;
}

/** Ontario public holidays used by “Load Ontario holidays” and seeds. */
export function ontarioHolidays(year) {
  const y = Number(year);
  const nthWeekday = (month, weekday, n) => {
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const d = new Date(y, month, day);
      if (d.getMonth() !== month) break;
      if (d.getDay() === weekday) {
        count += 1;
        if (count === n) return iso(d);
      }
    }
    return null;
  };
  const lastMondayBefore = (month, day) => {
    const d = new Date(y, month, day);
    while (d.getDay() !== 1) d.setDate(d.getDate() - 1);
    return iso(d);
  };
  // Anonymous Gregorian Easter (Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(y, month, day);
  const goodFriday = iso(addDays(easter, -2));

  const newYears = iso(new Date(y, 0, 1));
  const canadaDay = iso(new Date(y, 6, 1));
  const christmas = new Date(y, 11, 25);
  const boxing = new Date(y, 11, 26);
  const rows = [
    { date: newYears, name: "New Year's Day" },
    { date: nthWeekday(1, 1, 3), name: 'Family Day' },
    { date: goodFriday, name: 'Good Friday' },
    { date: lastMondayBefore(4, 25), name: 'Victoria Day' },
    { date: canadaDay, name: 'Canada Day' },
    { date: nthWeekday(8, 1, 1), name: 'Labour Day' },
    { date: nthWeekday(9, 1, 2), name: 'Thanksgiving Day' },
    { date: iso(christmas), name: 'Christmas Day' },
    { date: iso(boxing), name: 'Boxing Day' }
  ];
  // Ontario ESA: weekend Christmas/Boxing get weekday substitutes (Mon/Tue when both land on weekend).
  if (christmas.getDay() === 6 && boxing.getDay() === 0) {
    rows.push({ date: iso(addDays(christmas, 2)), name: 'Christmas Day (observed)' });
    rows.push({ date: iso(addDays(boxing, 2)), name: 'Boxing Day (observed)' });
  } else {
    if (christmas.getDay() === 6) rows.push({ date: iso(addDays(christmas, 2)), name: 'Christmas Day (observed)' });
    else if (christmas.getDay() === 0) rows.push({ date: iso(addDays(christmas, 1)), name: 'Christmas Day (observed)' });
    if (boxing.getDay() === 6) rows.push({ date: iso(addDays(boxing, 2)), name: 'Boxing Day (observed)' });
    else if (boxing.getDay() === 0) rows.push({ date: iso(addDays(boxing, 1)), name: 'Boxing Day (observed)' });
  }
  return rows.filter(r => r.date).map(r => ({ ...r, region: 'Ontario' }));
}
