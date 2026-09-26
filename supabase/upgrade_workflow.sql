-- Team Leave workflow upgrade: run once in the Supabase SQL editor.
alter table public.profiles add column if not exists team text not null default 'General';
alter table public.profiles add column if not exists manager_email text;
alter table public.leave_requests add column if not exists portion numeric(3,1) not null default 1;
alter table public.leave_requests add column if not exists decided_by uuid references public.profiles(id);

do $$ begin
  alter table public.leave_requests add constraint leave_requests_portion_check check (portion in (0.5,1));
exception when duplicate_object then null; end $$;

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
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  recipient_email text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.holidays enable row level security;
alter table public.notifications enable row level security;
alter table public.email_events enable row level security;
drop policy if exists "holidays_read" on public.holidays;
create policy "holidays_read" on public.holidays for select to authenticated using (true);
drop policy if exists "notifications_own_read" on public.notifications;
create policy "notifications_own_read" on public.notifications for select to authenticated using (lower(recipient_email)=lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update" on public.notifications for update to authenticated using (lower(recipient_email)=lower(coalesce(auth.jwt()->>'email',''))) with check (lower(recipient_email)=lower(coalesce(auth.jwt()->>'email','')));

create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where lower(email)=lower(coalesce(auth.jwt()->>'email','')) and role='manager')
$$;
create or replace function public.current_profile_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from profiles where lower(email)=lower(coalesce(auth.jwt()->>'email','')) limit 1
$$;

drop function if exists public.upsert_profile(text,text,integer,integer,text,uuid);
create or replace function public.upsert_profile(p_email text default null,p_name text default null,p_allowance integer default 25,p_used integer default 0,p_role text default 'employee',p_id uuid default null,p_team text default 'General',p_manager_email text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not is_manager() then raise exception 'Manager access required'; end if;
  if p_id is not null then
    update profiles set name=coalesce(p_name,name),allowance=p_allowance,used=p_used,role=p_role,team=coalesce(nullif(trim(p_team),''),'General'),manager_email=nullif(lower(trim(p_manager_email)),'') where id=p_id returning id into v_id;
  else
    insert into profiles(email,name,allowance,used,role,team,manager_email) values(lower(trim(p_email)),trim(p_name),p_allowance,p_used,p_role,coalesce(nullif(trim(p_team),''),'General'),nullif(lower(trim(p_manager_email)),''))
    on conflict(email) do update set name=excluded.name,allowance=excluded.allowance,team=excluded.team,manager_email=excluded.manager_email returning id into v_id;
  end if;
  return v_id;
end $$;

drop function if exists public.submit_leave(uuid,date,date,text);
create or replace function public.submit_leave(p_person uuid,p_start date,p_end date,p_note text default '',p_type text default 'Vacation',p_portion numeric default 1)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_days numeric; v_person profiles%rowtype;
begin
  if p_person<>current_profile_id() and not is_manager() then raise exception 'Not permitted'; end if;
  if p_end<p_start then raise exception 'End date must be on or after start date'; end if;
  if p_type not in ('Vacation','Sick','Personal','Unpaid','Work From Home') then raise exception 'Invalid request type'; end if;
  if p_portion not in (0.5,1) or (p_portion=0.5 and p_start<>p_end) then raise exception 'Invalid request duration'; end if;
  select count(*)*p_portion into v_days from generate_series(p_start,p_end,'1 day') d where extract(isodow from d)<6 and not exists(select 1 from holidays h where h.date=d::date);
  if v_days<=0 then raise exception 'Choose at least one business day'; end if;
  if exists(select 1 from leave_requests where person=p_person and status in ('pending','approved') and daterange(start,"end",'[]') && daterange(p_start,p_end,'[]')) then raise exception 'This request overlaps existing leave'; end if;
  select * into v_person from profiles where id=p_person;
  insert into leave_requests(person,start,"end",type,portion,status,note,submitted) values(p_person,p_start,p_end,p_type,p_portion,'pending',coalesce(p_note,''),now()) returning id into v_id;
  insert into notifications(recipient_email,title,message) select email,'New leave request',v_person.name||' requested '||v_days||' day(s).' from profiles where role='manager' and (team=v_person.team or lower(email)=lower(coalesce(v_person.manager_email,'')));
  insert into email_events(event,recipient_email,payload) select 'request_submitted',email,jsonb_build_object('request_id',v_id,'employee',v_person.name) from profiles where role='manager' and (team=v_person.team or lower(email)=lower(coalesce(v_person.manager_email,'')));
  return v_id;
end $$;

create or replace function public.update_leave(p_request uuid,p_start date,p_end date,p_note text default '',p_type text default 'Vacation',p_portion numeric default 1)
returns void language plpgsql security definer set search_path=public as $$
declare v_person uuid;
begin
  select person into v_person from leave_requests where id=p_request and status='pending';
  if v_person is null or (v_person<>current_profile_id() and not is_manager()) then raise exception 'Pending request not found'; end if;
  if p_end<p_start or p_portion not in (0.5,1) or (p_portion=0.5 and p_start<>p_end) then raise exception 'Invalid dates or duration'; end if;
  if p_type not in ('Vacation','Sick','Personal','Unpaid','Work From Home') then raise exception 'Invalid request type'; end if;
  if exists(select 1 from leave_requests where person=v_person and id<>p_request and status in ('pending','approved') and daterange(start,"end",'[]') && daterange(p_start,p_end,'[]')) then raise exception 'This request overlaps existing leave'; end if;
  update leave_requests set start=p_start,"end"=p_end,note=coalesce(p_note,''),type=p_type,portion=p_portion,submitted=now() where id=p_request;
end $$;

create or replace function public.decide_leave(p_request uuid,p_decision text,p_note text default '',p_override boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_row leave_requests%rowtype; v_person profiles%rowtype;
begin
  if not is_manager() then raise exception 'Manager access required'; end if;
  if p_decision not in ('approved','declined') then raise exception 'Invalid decision'; end if;
  if p_decision='declined' and trim(coalesce(p_note,''))='' then raise exception 'A decline reason is required'; end if;
  select * into v_row from leave_requests where id=p_request and status='pending' for update;
  if not found then raise exception 'Pending request not found'; end if;
  update leave_requests set status=p_decision,decision_note=coalesce(p_note,''),decided=now(),decided_by=current_profile_id() where id=p_request;
  select * into v_person from profiles where id=v_row.person;
  insert into notifications(recipient_email,title,message) values(v_person.email,'Request '||p_decision,'Your '||v_row.type||' request for '||v_row.start||' to '||v_row."end"||' was '||p_decision||'.');
  insert into email_events(event,recipient_email,payload) values('request_'||p_decision,v_person.email,jsonb_build_object('request_id',p_request,'note',coalesce(p_note,'')));
end $$;

create or replace function public.cancel_leave(p_request uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  update leave_requests set status='cancelled',decided=now() where id=p_request and person=current_profile_id() and status='pending';
  if not found then raise exception 'Pending request not found'; end if;
end $$;

create or replace function public.mark_notifications_read() returns void language sql security definer set search_path=public as $$
  update notifications set read=true where lower(recipient_email)=lower(coalesce(auth.jwt()->>'email',''))
$$;
create or replace function public.upsert_holiday(p_date date,p_name text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_manager() then raise exception 'Manager access required'; end if;
  insert into holidays(date,name) values(p_date,trim(p_name)) on conflict(date) do update set name=excluded.name;
end $$;

revoke all on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text) from public,anon;
revoke all on function public.submit_leave(uuid,date,date,text,text,numeric) from public,anon;
revoke all on function public.update_leave(uuid,date,date,text,text,numeric) from public,anon;
revoke all on function public.decide_leave(uuid,text,text,boolean) from public,anon;
revoke all on function public.cancel_leave(uuid) from public,anon;
revoke all on function public.mark_notifications_read() from public,anon;
revoke all on function public.upsert_holiday(date,text) from public,anon;
grant execute on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text),public.submit_leave(uuid,date,date,text,text,numeric),public.update_leave(uuid,date,date,text,text,numeric),public.decide_leave(uuid,text,text,boolean),public.cancel_leave(uuid),public.mark_notifications_read(),public.upsert_holiday(date,text) to authenticated;
grant select on public.holidays to authenticated;
grant select,update on public.notifications to authenticated;
