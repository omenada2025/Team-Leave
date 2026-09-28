import {
  setTeam, setHolidays, remaining, balanceDuration, requestDuration, validateRequest,
  businessDays, coverageFor, minimumCoverage, holidayName, managesPerson, ontarioHolidays,
  activePeople
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

const on2026 = ontarioHolidays(2026);
assert('ontario 2026 includes Canada Day', on2026.some(h => h.date === '2026-07-01' && h.name === 'Canada Day'));
assert('ontario 2026 boxing observed', on2026.some(h => h.date === '2026-12-28'));
const on2027 = ontarioHolidays(2027);
assert('ontario 2027 family day', on2027.some(h => h.date === '2027-02-15'));
assert('ontario 2027 observed pair', on2027.some(h => h.date === '2027-12-27') && on2027.some(h => h.date === '2027-12-28'));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll logic checks passed.');
