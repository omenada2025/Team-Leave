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
  assert(`${label}: manages_person excludes self`, /me\.id\s*<>\s*p_person/.test(sql));
  assert(`${label}: decide_leave team scope`, /you can only decide requests for your team/i.test(sql));
  assert(`${label}: delete_holiday`, /create or replace function public\.delete_holiday/i.test(sql));
  assert(`${label}: set_minimum_coverage`, /create or replace function public\.set_minimum_coverage/i.test(sql));
  assert(`${label}: set_profile_active`, /create or replace function public\.set_profile_active/i.test(sql));
  assert(`${label}: rollover_leave_year`, /create or replace function public\.rollover_leave_year/i.test(sql));
  assert(`${label}: team_settings`, /create table if not exists public\.team_settings/i.test(sql));
  assert(`${label}: profiles.active`, /active boolean not null default true/i.test(sql) || /add column if not exists active/i.test(sql));
  assert(`${label}: must_change_password column`, /must_change_password boolean not null default false/i.test(sql) || /add column if not exists must_change_password/i.test(sql));
  assert(`${label}: clear_must_change_password`, /create or replace function public\.clear_must_change_password/i.test(sql));
  assert(`${label}: set_must_change_password`, /create or replace function public\.set_must_change_password/i.test(sql));
  assert(`${label}: upsert sets must_change on insert`, /must_change_password = true/i.test(sql));
  assert(`${label}: upsert_profile p_active`, /p_active boolean default true/i.test(sql));
  assert(`${label}: is_admin`, /create or replace function public\.is_admin/i.test(sql));
  assert(`${label}: upsert_profile admin gate`, /if not is_admin\(\) then raise exception 'Admin access required/i.test(sql));
  assert(`${label}: role allows admin`, /role in \('employee','manager','admin'\)/i.test(sql));
  assert(`${label}: list_profile_auth_status`, /create or replace function public\.list_profile_auth_status/i.test(sql));
  assert(`${label}: notification request_id`, /request_id/i.test(sql));
  assert(`${label}: last_rollover_at`, /last_rollover_at/i.test(sql));
}

assert('upgrade drops email_events', /drop table if exists public\.email_events/i.test(upgrade));
assert('schema drops email_events', /drop table if exists public\.email_events/i.test(schema));
assert('upgrade reloads PostgREST cache', /notify pgrst,\s*'reload schema'/i.test(upgrade));

const hotfix = readFileSync(join(dir, 'hotfix_upsert_profile.sql'), 'utf8');
assert('hotfix has upsert_profile p_active', /p_active boolean default true/i.test(hotfix));
assert('hotfix reloads PostgREST cache', /notify pgrst,\s*'reload schema'/i.test(hotfix));
assert('hotfix admin gate', /if not is_admin\(\)/i.test(hotfix));
assert('hotfix promotes Daniela to admin', /role = 'admin'/.test(hotfix) && /rdaniglad@gmail\.com/.test(hotfix));

const liveHotfix = readFileSync(join(dir, 'hotfix_live_rpcs.sql'), 'utf8');
assert('live hotfix has is_invited_email', /create or replace function public\.is_invited_email/i.test(liveHotfix));
assert('live hotfix grants is_invited_email to anon', /grant execute on function public\.is_invited_email\(text\) to anon/i.test(liveHotfix));
assert('live hotfix has upsert_profile p_active', /p_active boolean default true/i.test(liveHotfix));
assert('live hotfix has set_profile_active', /create or replace function public\.set_profile_active/i.test(liveHotfix));
assert('live hotfix has is_admin', /create or replace function public\.is_admin/i.test(liveHotfix));
assert('live hotfix reloads PostgREST cache', /notify pgrst,\s*'reload schema'/i.test(liveHotfix));
assert('live hotfix promotes Daniela to admin', /role = 'admin'/.test(liveHotfix) && /rdaniglad@gmail\.com/.test(liveHotfix));

const mustChangeHotfix = readFileSync(join(dir, 'hotfix_must_change_password.sql'), 'utf8');
assert('must_change hotfix has column', /add column if not exists must_change_password/i.test(mustChangeHotfix));
assert('must_change hotfix has clear RPC', /create or replace function public\.clear_must_change_password/i.test(mustChangeHotfix));
assert('must_change hotfix has set RPC', /create or replace function public\.set_must_change_password/i.test(mustChangeHotfix));
assert('must_change hotfix reloads PostgREST cache', /notify pgrst,\s*'reload schema'/i.test(mustChangeHotfix));

const seed = readFileSync(join(dir, 'seed_ontario_holidays.sql'), 'utf8');
assert('seed has 2027', /2027-01-01/.test(seed));
assert('seed has 2028', /2028-01-01/.test(seed));

if (failed) {
  console.error(`\n${failed} SQL check(s) failed`);
  process.exit(1);
}
console.log('\nAll SQL checks passed.');
