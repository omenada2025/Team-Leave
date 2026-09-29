#!/usr/bin/env node
/** Light static checks on SQL sources — no live Supabase required. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'supabase');
let failed = 0;
const assert = (name, cond) => {
  if (!cond) { failed += 1; console.error('FAIL', name); }
  else console.log('ok', name);
};

const files = readdirSync(dir).filter(f => f.endsWith('.sql'));
assert('sql files present', files.includes('schema.sql') && files.includes('upgrade_workflow.sql'));

const schema = readFileSync(join(dir, 'schema.sql'), 'utf8');
const upgrade = readFileSync(join(dir, 'upgrade_workflow.sql'), 'utf8');

for (const [label, sql] of [['schema', schema], ['upgrade', upgrade]]) {
  assert(`${label}: no email_events writes`, !/insert into\s+email_events/i.test(sql));
  assert(`${label}: manages_person exists`, /create or replace function public\.manages_person/i.test(sql));
  assert(`${label}: decide_leave team scope`, /you can only decide requests for your team/i.test(sql));
  assert(`${label}: delete_holiday`, /create or replace function public\.delete_holiday/i.test(sql));
  assert(`${label}: set_minimum_coverage`, /create or replace function public\.set_minimum_coverage/i.test(sql));
  assert(`${label}: set_profile_active`, /create or replace function public\.set_profile_active/i.test(sql));
  assert(`${label}: rollover_leave_year`, /create or replace function public\.rollover_leave_year/i.test(sql));
  assert(`${label}: team_settings`, /create table if not exists public\.team_settings/i.test(sql));
  assert(`${label}: profiles.active`, /active boolean not null default true/i.test(sql) || /add column if not exists active/i.test(sql));
}

assert('upgrade drops email_events', /drop table if exists public\.email_events/i.test(upgrade));
assert('schema drops email_events', /drop table if exists public\.email_events/i.test(schema));

const seed = readFileSync(join(dir, 'seed_ontario_holidays.sql'), 'utf8');
assert('seed has 2027', /2027-01-01/.test(seed));
assert('seed has 2028', /2028-01-01/.test(seed));

if (failed) {
  console.error(`\n${failed} SQL check(s) failed`);
  process.exit(1);
}
console.log('\nAll SQL checks passed.');
