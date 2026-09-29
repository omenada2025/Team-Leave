-- Team Leave — upgrade for existing Supabase projects.
-- Idempotent. Safe to re-run in the SQL editor after deploying this branch.
-- Then seed holidays if needed (seed_ontario_holidays.sql or in-app Load Ontario holidays).
--
-- Adds / restores: team-scoped managers, configurable coverage, soft-deactivate,
-- holiday delete, year rollover (carry-over = 0), drops unused email_events,
-- upsert_profile(... p_active) matching the Pages client RPC args,
-- admin role (Users page + user-admin RPCs; managers keep leave approval).
--
-- If Edit user → Save fails with "Could not find ... upsert_profile(...p_active...)",
-- or Create password fails with "Could not find ... is_invited_email...",
-- prefer this full upgrade. For a smaller invite/Users emergency paste, see
-- hotfix_live_rpcs.sql (supersedes hotfix_upsert_profile.sql).

alter table public.profiles add column if not exists team text not null default 'General';
alter table public.profiles add column if not exists manager_email text;
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
-- Allow admin role (Users page + user-admin RPCs).
do $$ begin
  alter table public.profiles drop constraint if exists profiles_role_check;
exception when undefined_object then null; end $$;
alter table public.profiles add constraint profiles_role_check check (role in ('employee','manager','admin'));

alter table public.leave_requests add column if not exists portion numeric(3,1) not null default 1;
alter table public.leave_requests add column if not exists decided_by uuid references public.profiles(id);

do $$ begin
  alter table public.leave_requests add constraint leave_requests_portion_check check (portion in (0.5,1));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leave_requests add constraint leave_requests_type_check
    check (type in ('Vacation','Sick','Personal','Unpaid','Work From Home'));
exception when duplicate_object then null; end $$;

-- Keep leave history when a profile is removed; soft-delete is preferred.
do $$ begin
  alter table public.leave_requests drop constraint if exists leave_requests_person_fkey;
  alter table public.leave_requests
    add constraint leave_requests_person_fkey
    foreign key (person) references public.profiles(id);
exception when others then null; end $$;

create table if not exists public.holidays (
  date date primary key,
  name text not null,
  region text not null default 'North America'
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications add column if not exists request_id uuid references public.leave_requests(id) on delete set null;
create table if not exists public.team_settings (
  id integer primary key default 1 check (id = 1),
  minimum_coverage integer check (minimum_coverage is null or minimum_coverage >= 1),
  updated_at timestamptz not null default now()
);
alter table public.team_settings add column if not exists last_rollover_at timestamptz;
insert into public.team_settings(id, minimum_coverage) values (1, null)
on conflict (id) do nothing;

-- Dead email queue — nothing sends these. In-app notifications only.
drop table if exists public.email_events;

alter table public.holidays enable row level security;
alter table public.notifications enable row level security;
alter table public.team_settings enable row level security;

create or replace function public.current_profile_id() returns uuid
language sql stable security definer set search_path=public as $$
  select id from profiles where lower(email)=lower(coalesce(auth.jwt()->>'email','')) and active limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=current_profile_id() and role='admin' and active)
$$;

-- Managers and admins can run leave-approval / coverage RPCs.
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=current_profile_id() and role in ('manager','admin') and active)
$$;

-- Admins manage everyone (except self). Managers: same team OR manager_email match.
-- Never true for self (align with decide_leave + UI managesPerson).
create or replace function public.manages_person(p_person uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from profiles me
    join profiles them on them.id = p_person
    where me.id = current_profile_id()
      and me.id <> p_person
      and me.active
      and (
        me.role = 'admin'
        or (
          me.role = 'manager'
          and (
            them.team = me.team
            or lower(coalesce(them.manager_email, '')) = lower(me.email)
          )
        )
      )
  )
$$;

create or replace function public.is_invited_email(p_email text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where lower(email)=lower(trim(p_email)) and active)
$$;

create or replace function public.leave_duration(p_start date, p_end date, p_portion numeric)
returns numeric language sql stable set search_path=public as $$
  select coalesce(
    (select count(*)::numeric * p_portion
     from generate_series(p_start, p_end, '1 day') as g(day)
     where extract(isodow from day) < 6
       and not exists (select 1 from holidays h where h.date = day::date)),
    0
  )
$$;

create or replace function public.balance_duration(p_type text, p_start date, p_end date, p_portion numeric)
returns numeric language sql stable set search_path=public as $$
  select case when p_type = 'Vacation' then public.leave_duration(p_start, p_end, p_portion) else 0 end
$$;

create or replace function public.vacation_available(
  p_person uuid,
  p_year integer,
  p_include_pending boolean default true,
  p_exclude uuid default null
) returns numeric language sql stable set search_path=public as $$
  select greatest(0,
    coalesce((select p.allowance - p.used from profiles p where p.id = p_person), 0)
    - coalesce((
        select sum(public.balance_duration(r.type, r.start, r."end", r.portion))
        from leave_requests r
        where r.person = p_person
          and extract(year from r.start) = p_year
          and (p_exclude is null or r.id <> p_exclude)
          and (
            r.status = 'approved'
            or (p_include_pending and r.status = 'pending')
          )
      ), 0)
  )
$$;

create or replace function public.active_headcount() returns integer
language sql stable set search_path=public as $$
  select count(*)::integer from profiles where active
$$;

create or replace function public.coverage_minimum() returns integer
language sql stable set search_path=public as $$
  select coalesce(
    (select minimum_coverage from team_settings where id = 1),
    case
      when public.active_headcount() <= 3 then greatest(1, public.active_headcount() - 1)
      else greatest(1, public.active_headcount() - 2)
    end
  )
$$;

create or replace function public.has_coverage_conflict(p_person uuid, p_start date, p_end date, p_exclude uuid default null)
returns boolean language plpgsql stable set search_path=public as $$
declare
  v_n integer;
  v_min integer;
  v_day date;
  v_away integer;
begin
  if p_end < p_start then
    return false;
  end if;
  v_n := public.active_headcount();
  v_min := public.coverage_minimum();
  for v_day in
    select g.day::date from generate_series(p_start, p_end, '1 day') as g(day)
    where extract(isodow from g.day) < 6
      and not exists (select 1 from holidays h where h.date = g.day::date)
  loop
    -- Count pending + approved absences (WFH does not reduce coverage).
    select count(distinct r.person)::integer into v_away
    from leave_requests r
    join profiles p on p.id = r.person and p.active
    where r.status in ('approved', 'pending')
      and r.type <> 'Work From Home'
      and (p_exclude is null or r.id <> p_exclude)
      and r.start <= v_day and r."end" >= v_day;
    if not exists (
      select 1 from leave_requests r
      where r.status in ('approved', 'pending')
        and r.type <> 'Work From Home'
        and r.person = p_person
        and (p_exclude is null or r.id <> p_exclude)
        and r.start <= v_day and r."end" >= v_day
    ) then
      v_away := v_away + 1;
    end if;
    if (v_n - v_away) < v_min then
      return true;
    end if;
  end loop;
  return false;
end $$;

drop policy if exists "holidays_read" on public.holidays;
drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays for select to authenticated using (true);
drop policy if exists "notifications_own_read" on public.notifications;
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications
  for select to authenticated
  using (lower(recipient_email)=lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists "notifications_own_update" on public.notifications;
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications
  for update to authenticated
  using (lower(recipient_email)=lower(coalesce(auth.jwt()->>'email','')))
  with check (lower(recipient_email)=lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists leave_team_read on public.leave_requests;
create policy leave_team_read on public.leave_requests
  for select to authenticated
  using (
    current_profile_id() is not null and (
      person = current_profile_id()
      or status = 'approved'
      or (is_manager() and manages_person(person))
    )
  );
drop policy if exists team_settings_read on public.team_settings;
create policy team_settings_read on public.team_settings
  for select to authenticated using (current_profile_id() is not null);

-- Drop every known overload so PostgREST only exposes the current signature.
drop function if exists public.upsert_profile(text,text,integer,integer,text,uuid);
drop function if exists public.upsert_profile(text,text,integer,integer,text,uuid,text,text);
drop function if exists public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean);
create or replace function public.upsert_profile(
  p_email text default null,
  p_name text default null,
  p_allowance integer default 25,
  p_used integer default 0,
  p_role text default 'employee',
  p_id uuid default null,
  p_team text default 'General',
  p_manager_email text default null,
  p_active boolean default true
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not is_admin() then raise exception 'Admin access required.'; end if;
  if p_role is not null and p_role not in ('employee','manager','admin') then raise exception 'Invalid role.'; end if;
  if p_id is not null then
    update profiles set
      name = coalesce(p_name, name),
      allowance = p_allowance,
      used = p_used,
      role = p_role,
      team = coalesce(nullif(trim(p_team),''),'General'),
      manager_email = nullif(lower(trim(p_manager_email)),''),
      active = coalesce(p_active, active)
    where id = p_id returning id into v_id;
  else
    insert into profiles(email,name,allowance,used,role,team,manager_email,active,must_change_password)
    values(
      lower(trim(p_email)),
      trim(p_name),
      p_allowance,
      p_used,
      p_role,
      coalesce(nullif(trim(p_team),''),'General'),
      nullif(lower(trim(p_manager_email)),''),
      coalesce(p_active, true),
      true
    )
    on conflict(email) do update set
      name = excluded.name,
      allowance = excluded.allowance,
      team = excluded.team,
      manager_email = excluded.manager_email,
      active = true,
      must_change_password = true
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.clear_must_change_password()
returns void language plpgsql security definer set search_path=public as $$
begin
  update profiles
  set must_change_password = false
  where id = current_profile_id();
  if not found then raise exception 'Profile not found.'; end if;
end $$;

create or replace function public.set_must_change_password(p_id uuid, p_value boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Admin access required.'; end if;
  update profiles set must_change_password = coalesce(p_value, true) where id = p_id;
  if not found then raise exception 'User not found.'; end if;
end $$;

create or replace function public.set_profile_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Admin access required.'; end if;
  if p_id = current_profile_id() then raise exception 'You cannot deactivate your own account.'; end if;
  update profiles set active = p_active where id = p_id;
  if not found then raise exception 'User not found.'; end if;
end $$;

create or replace function public.set_minimum_coverage(p_minimum integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Manager access required.'; end if;
  if p_minimum is not null and p_minimum < 1 then raise exception 'Minimum coverage must be at least 1.'; end if;
  insert into team_settings(id, minimum_coverage, updated_at)
  values (1, p_minimum, now())
  on conflict (id) do update set minimum_coverage = excluded.minimum_coverage, updated_at = now();
end $$;

create or replace function public.rollover_leave_year()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  if not is_manager() then raise exception 'Manager access required.'; end if;
  update profiles p
  set used = 0
  where p.active and manages_person(p.id);
  get diagnostics v_count = row_count;
  update profiles set used = 0 where id = current_profile_id();
  insert into team_settings(id, minimum_coverage, last_rollover_at, updated_at)
  values (1, null, now(), now())
  on conflict (id) do update set last_rollover_at = now(), updated_at = now();
  return v_count;
end $$;

drop function if exists public.submit_leave(uuid,date,date,text);
create or replace function public.submit_leave(
  p_person uuid,
  p_start date,
  p_end date,
  p_note text default '',
  p_type text default 'Vacation',
  p_portion numeric default 1
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_me uuid := current_profile_id();
  v_id uuid;
  v_days numeric;
  v_burn numeric;
  v_available numeric;
  v_person profiles%rowtype;
begin
  if v_me is null then raise exception 'Your email is not on this team.'; end if;
  if p_person <> v_me and not (is_manager() and manages_person(p_person)) then
    raise exception 'Employees can only request leave for themselves.';
  end if;
  if p_start < current_date or p_end < p_start then raise exception 'Choose valid dates.'; end if;
  if extract(year from p_start) <> extract(year from p_end)
     or extract(year from p_start) <> extract(year from current_date) then
    raise exception 'Keep this request within the current leave year.';
  end if;
  if p_type not in ('Vacation','Sick','Personal','Unpaid','Work From Home') then
    raise exception 'Invalid request type.';
  end if;
  if p_portion not in (0.5,1) or (p_portion = 0.5 and p_start <> p_end) then
    raise exception 'Invalid request duration.';
  end if;
  select * into v_person from profiles where id = p_person and active;
  if not found then raise exception 'Employee not found.'; end if;

  v_days := public.leave_duration(p_start, p_end, p_portion);
  if v_days <= 0 then raise exception 'Choose at least one business day.'; end if;
  if exists(
    select 1 from leave_requests
    where person = p_person and status in ('pending','approved')
      and daterange(start,"end",'[]') && daterange(p_start,p_end,'[]')
  ) then raise exception 'This request overlaps an existing request.'; end if;

  v_burn := public.balance_duration(p_type, p_start, p_end, p_portion);
  if v_burn > 0 then
    v_available := public.vacation_available(p_person, extract(year from p_start)::integer, true, null);
    if v_burn > v_available then
      raise exception 'This request exceeds the available balance.';
    end if;
  end if;

  insert into leave_requests(person,start,"end",type,portion,status,note,submitted)
  values(p_person,p_start,p_end,p_type,p_portion,'pending',left(coalesce(p_note,''),500),now())
  returning id into v_id;

  insert into notifications(recipient_email,title,message,request_id)
  select email, 'New request', v_person.name||' submitted a '||p_type||' request ('||v_days||' day(s)).', v_id
  from profiles
  where role = 'manager' and active
    and (team = v_person.team or lower(email) = lower(coalesce(v_person.manager_email,'')));

  return v_id;
end $$;

create or replace function public.update_leave(
  p_request uuid,
  p_start date,
  p_end date,
  p_note text default '',
  p_type text default 'Vacation',
  p_portion numeric default 1
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_row leave_requests%rowtype;
  v_days numeric;
  v_burn numeric;
  v_available numeric;
begin
  select * into v_row from leave_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Pending request not found.'; end if;
  if v_row.person <> current_profile_id()
     and not (is_manager() and manages_person(v_row.person)) then
    raise exception 'Pending request not found.';
  end if;
  if p_start < current_date or p_end < p_start then raise exception 'Choose valid dates.'; end if;
  if extract(year from p_start) <> extract(year from p_end)
     or extract(year from p_start) <> extract(year from current_date) then
    raise exception 'Keep this request within the current leave year.';
  end if;
  if p_portion not in (0.5,1) or (p_portion = 0.5 and p_start <> p_end) then
    raise exception 'Invalid dates or duration.';
  end if;
  if p_type not in ('Vacation','Sick','Personal','Unpaid','Work From Home') then
    raise exception 'Invalid request type.';
  end if;
  v_days := public.leave_duration(p_start, p_end, p_portion);
  if v_days <= 0 then raise exception 'Choose at least one business day.'; end if;
  if exists(
    select 1 from leave_requests
    where person = v_row.person and id <> p_request and status in ('pending','approved')
      and daterange(start,"end",'[]') && daterange(p_start,p_end,'[]')
  ) then raise exception 'This request overlaps an existing request.'; end if;

  v_burn := public.balance_duration(p_type, p_start, p_end, p_portion);
  if v_burn > 0 then
    v_available := public.vacation_available(v_row.person, extract(year from p_start)::integer, true, p_request);
    if v_burn > v_available then
      raise exception 'This request exceeds the available balance.';
    end if;
  end if;

  update leave_requests
  set start = p_start, "end" = p_end, note = left(coalesce(p_note,''),500),
      type = p_type, portion = p_portion, submitted = now()
  where id = p_request;
end $$;

create or replace function public.decide_leave(
  p_request uuid,
  p_decision text,
  p_note text default '',
  p_override boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_row leave_requests%rowtype;
  v_person profiles%rowtype;
  v_burn numeric;
  v_available numeric;
begin
  if not is_manager() then raise exception 'Manager access required.'; end if;
  if p_decision not in ('approved','declined') then raise exception 'Invalid decision.'; end if;
  if p_decision = 'declined' and trim(coalesce(p_note,'')) = '' then
    raise exception 'A decline reason is required.';
  end if;

  select * into v_row from leave_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Pending request not found.'; end if;
  if v_row.person = current_profile_id() then
    raise exception 'A manager cannot decide their own request.';
  end if;
  if not manages_person(v_row.person) then
    raise exception 'You can only decide requests for your team.';
  end if;

  if p_decision = 'approved' then
    v_burn := public.balance_duration(v_row.type, v_row.start, v_row."end", v_row.portion);
    if v_burn > 0 then
      v_available := public.vacation_available(v_row.person, extract(year from v_row.start)::integer, true, v_row.id);
      if v_burn > v_available then
        raise exception 'The employee no longer has enough available days.';
      end if;
    end if;

    if v_row.type <> 'Work From Home'
       and not p_override
       and public.has_coverage_conflict(v_row.person, v_row.start, v_row."end", v_row.id) then
      raise exception 'Confirm arranged coverage before approving this conflict.';
    end if;
  end if;

  update leave_requests
  set status = p_decision,
      decision_note = left(coalesce(p_note,''),500),
      decided = now(),
      decided_by = current_profile_id()
  where id = p_request;

  select * into v_person from profiles where id = v_row.person;
  insert into notifications(recipient_email,title,message,request_id)
  values(
    v_person.email,
    'Request '||p_decision,
    'Your '||v_row.type||' request for '||v_row.start||' to '||v_row."end"||' was '||p_decision||'.',
    v_row.id
  );
end $$;

create or replace function public.cancel_leave(p_request uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  update leave_requests
  set status = 'cancelled', decided = now()
  where id = p_request and person = current_profile_id() and status = 'pending';
  if not found then raise exception 'Pending request not found.'; end if;
end $$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path=public as $$
  update notifications set read = true
  where lower(recipient_email) = lower(coalesce(auth.jwt()->>'email',''))
$$;

create or replace function public.list_profile_auth_status()
returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Admin access required.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'has_auth', exists (
        select 1 from auth.users u where lower(u.email) = lower(p.email)
      )
    ) order by p.name)
    from public.profiles p
  ), '[]'::jsonb);
end $$;

drop function if exists public.upsert_holiday(date,text);
create or replace function public.upsert_holiday(p_date date, p_name text, p_region text default 'Ontario') returns void
language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Manager access required.'; end if;
  insert into holidays(date,name,region) values(p_date, trim(p_name), coalesce(nullif(trim(p_region),''),'Ontario'))
  on conflict(date) do update set name = excluded.name, region = excluded.region;
end $$;

create or replace function public.delete_holiday(p_date date) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Manager access required.'; end if;
  delete from holidays where date = p_date;
  if not found then raise exception 'Holiday not found.'; end if;
end $$;

revoke all on function public.is_invited_email(text) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) from public,anon;
revoke all on function public.clear_must_change_password() from public,anon;
revoke all on function public.set_must_change_password(uuid,boolean) from public,anon;
revoke all on function public.set_profile_active(uuid,boolean) from public,anon;
revoke all on function public.set_minimum_coverage(integer) from public,anon;
revoke all on function public.rollover_leave_year() from public,anon;
revoke all on function public.submit_leave(uuid,date,date,text,text,numeric) from public,anon;
revoke all on function public.update_leave(uuid,date,date,text,text,numeric) from public,anon;
revoke all on function public.decide_leave(uuid,text,text,boolean) from public,anon;
revoke all on function public.cancel_leave(uuid) from public,anon;
revoke all on function public.mark_notifications_read() from public,anon;
revoke all on function public.list_profile_auth_status() from public,anon;
revoke all on function public.upsert_holiday(date,text,text) from public,anon;
revoke all on function public.delete_holiday(date) from public,anon;

grant execute on function public.is_invited_email(text) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
grant execute on function public.set_must_change_password(uuid,boolean) to authenticated;
grant execute on function public.set_profile_active(uuid,boolean) to authenticated;
grant execute on function public.set_minimum_coverage(integer) to authenticated;
grant execute on function public.rollover_leave_year() to authenticated;
grant execute on function public.submit_leave(uuid,date,date,text,text,numeric) to authenticated;
grant execute on function public.update_leave(uuid,date,date,text,text,numeric) to authenticated;
grant execute on function public.decide_leave(uuid,text,text,boolean) to authenticated;
grant execute on function public.cancel_leave(uuid) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.list_profile_auth_status() to authenticated;
grant execute on function public.upsert_holiday(date,text,text) to authenticated;
grant execute on function public.delete_holiday(date) to authenticated;

grant select on public.holidays to authenticated;
grant select on public.team_settings to authenticated;
grant select, update on public.notifications to authenticated;

-- Make new/replaced RPCs visible to the API immediately (avoids stale schema-cache 404s).
-- Ensure the primary operator can open Users (admin-only).
update public.profiles
set role = 'admin', active = true
where lower(email) = 'rdaniglad@gmail.com';

notify pgrst, 'reload schema';
