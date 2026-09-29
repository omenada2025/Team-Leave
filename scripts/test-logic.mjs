import {
  setTeam, setHolidays, remaining, balanceDuration, requestDuration, validateRequest,
  businessDays, coverageFor, minimumCoverage, holidayName, managesPerson, ontarioHolidays,
  activePeople, defaultCoverageMinimum, hasOwnLeaveOverlap, dayKey
} from '../src/logic.mjs';

let failed = 0;
const assert = (name, cond) => {
  if (!cond) { failed += 1; console.error('FAIL', name); }
  else console.log('ok', name);
};

setTeam([
  { id: 'a', name: 'Alex Example', email: 'a@x.com', allowance: 25, used: 2, role: 'employee', team: 'General', active: true },
  { id: 'b', name: 'Bea Example', email: 'b@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: true },
  { id: 'c', name: 'Cam Example', email: 'c@x.com', allowance: 25, used: 0, role: 'manager', team: 'General', active: true },
  { id: 'd', name: 'Dee Other', email: 'd@x.com', allowance: 25, used: 0, role: 'employee', team: 'Ops', manager_email: 'other@x.com', active: true },
  { id: 'e', name: 'Eve Inactive', email: 'e@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: false }
], 1);
setHolidays([{ date: '2026-07-01', name: 'Canada Day' }]);

const reqs = [
  { id: '1', person: 'a', start: '2026-06-01', end: '2026-06-05', portion: 1, type: 'Vacation', status: 'approved' },
  { id: '2', person: 'a', start: '2026-06-10', end: '2026-06-10', portion: 0.5, type: 'Vacation', status: 'pending' },
  { id: '3', person: 'a', start: '2026-06-15', end: '2026-06-16', portion: 1, type: 'Sick', status: 'approved' },
  { id: '4', person: 'a', start: '2026-06-20', end: '2026-06-20', portion: 1, type: 'Work From Home', status: 'approved' }
];

const b = remaining('a', reqs);
assert('approved vacation weekdays', b.approved === 5);
assert('pending half day', b.pending === 0.5);
assert('available ignores pending display', b.available === 18);
assert('sick does not burn', balanceDuration(reqs[2]) === 0);
assert('wfh does not burn', balanceDuration(reqs[3]) === 0);
assert('half duration', requestDuration(reqs[1]) === 0.5);
assert('holiday-aware weekdays', businessDays('2026-06-29', '2026-07-03') === 4);
assert('holiday name preserved', holidayName('2026-07-01') === 'Canada Day');

const today = new Date('2026-05-01T12:00:00');
assert('sick over balance allowed', validateRequest({ start: '2026-08-03', end: '2026-08-31', person: 'a', type: 'Sick', portion: 1 }, reqs, today) === null);
assert('vacation over balance blocked', !!validateRequest({ start: '2026-08-03', end: '2026-08-31', person: 'a', type: 'Vacation', portion: 1 }, reqs, today));
assert('pending reserves balance', !!validateRequest({ start: '2026-08-03', end: '2026-08-26', person: 'a', type: 'Vacation', portion: 1 }, reqs, today));
assert('end before start rejected', validateRequest({ start: '2026-10-30', end: '2026-10-05', person: 'b', type: 'Vacation', portion: 1 }, reqs, today) === 'The end date must be on or after the start date.');
assert('own overlap detected', hasOwnLeaveOverlap('a', '2026-06-03', '2026-06-04', reqs) === true);

const conflicts = coverageFor('2026-06-01', '2026-06-05', reqs, 'b').filter(d => d.conflict);
assert('coverage minimum formula wired', minimumCoverage === 1);
assert('coverage can flag conflicts', Array.isArray(conflicts));
assert('inactive excluded from headcount', activePeople().length === 4);

const manager = { id: 'c', name: 'Cam', email: 'c@x.com', role: 'manager', team: 'General' };
assert('manager scopes same team', managesPerson(manager, { id: 'a', team: 'General', manager_email: null }));
assert('manager scopes by manager_email', managesPerson(
  { id: 'm', email: 'boss@x.com', role: 'manager', team: 'X' },
  { id: 'a', team: 'Y', manager_email: 'boss@x.com' }
));
assert('manager does not scope other team', !managesPerson(manager, { id: 'd', team: 'Ops', manager_email: 'other@x.com' }));
assert('manager cannot manage self', !managesPerson(manager, manager));
const admin = { id: 'admin1', name: 'Ada', email: 'ada@x.com', role: 'admin', team: 'Ops' };
assert('admin manages other team', managesPerson(admin, { id: 'd', team: 'Ops', manager_email: 'other@x.com' }));
assert('admin cannot manage self', !managesPerson(admin, admin));
assert('employee cannot manage', !managesPerson({ id: 'a', role: 'employee', team: 'General' }, { id: 'b', team: 'General' }));

const on2026 = ontarioHolidays(2026);
assert('ontario 2026 includes Canada Day', on2026.some(h => h.date === '2026-07-01' && h.name === 'Canada Day'));
assert('ontario 2026 boxing observed', on2026.some(h => h.date === '2026-12-28'));
const on2027 = ontarioHolidays(2027);
assert('ontario 2027 family day', on2027.some(h => h.date === '2027-02-15'));
assert('ontario 2027 observed pair', on2027.some(h => h.date === '2027-12-27') && on2027.some(h => h.date === '2027-12-28'));

assert('default min 3-person team is 2', defaultCoverageMinimum(3) === 2);
assert('default min 4-person team is 2', defaultCoverageMinimum(4) === 2);
assert('default min 2-person team is 1', defaultCoverageMinimum(2) === 1);
assert('dayKey strips timestamptz', dayKey('2026-10-30T00:00:00+00') === '2026-10-30');

// Daniela / dani style review: 3-person team, one approved long leave, pending same day.
setTeam([
  { id: 'daniela', name: 'Daniela Omena', email: 'd@x.com', allowance: 25, used: 0, role: 'admin', team: 'General', active: true },
  { id: 'dani', name: 'dani', email: 'dani@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: true },
  { id: 'other', name: 'Other', email: 'o@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: true }
], null);
assert('small team auto minimum is 2', minimumCoverage === 2);
const liveReqs = [
  { id: 'vac', person: 'daniela', start: '2026-10-30', end: '2026-11-26', portion: 1, type: 'Vacation', status: 'approved' },
  { id: 'pers', person: 'dani', start: '2026-10-30', end: '2026-10-30', portion: 1, type: 'Personal', status: 'pending' }
];
const reviewRisk = coverageFor('2026-10-30', '2026-10-30', liveReqs, 'dani', 'pers').filter(d => d.conflict);
assert('review flags conflict when second person overlaps approved leave', reviewRisk.length === 1);
assert('review available drops to 1', reviewRisk[0].available === 1);

// Pending teammate also reduces availability (same day, different people).
setTeam([
  { id: 'p1', name: 'P1', email: '1@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: true },
  { id: 'p2', name: 'P2', email: '2@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: true },
  { id: 'p3', name: 'P3', email: '3@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: true },
  { id: 'p4', name: 'P4', email: '4@x.com', allowance: 25, used: 0, role: 'employee', team: 'General', active: true }
], 2);
const pendingReqs = [
  { id: 'a1', person: 'p1', start: '2026-09-01', end: '2026-09-01', portion: 1, type: 'Vacation', status: 'approved' },
  { id: 'a2', person: 'p2', start: '2026-09-01', end: '2026-09-01', portion: 1, type: 'Sick', status: 'pending' }
];
const pendingRisk = coverageFor('2026-09-01', '2026-09-01', pendingReqs, 'p3', null).filter(d => d.conflict);
assert('pending absences count toward coverage', pendingRisk.length === 1 && pendingRisk[0].available === 1);

// Invalid / empty range yields no coverage days (caller must not claim "no conflict").
assert('inverted range yields empty coverage days', coverageFor('2026-10-30', '2026-10-05', liveReqs, 'dani').length === 0);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll logic checks passed.');
