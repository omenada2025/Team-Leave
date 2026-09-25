create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  allowance integer not null default 25 check (allowance between 0 and 100),
  used integer not null default 0 check (used between 0 and allowance),
  role text not null default 'employee' check (role in ('employee','manager'))
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  person uuid not null references public.profiles(id) on delete cascade,
  start date not null,
  "end" date not null,
  type text not null default 'Vacation',
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  note text not null default '',
  decision_note text not null default '',
  submitted date not null default current_date,
  decided date,
  check ("end" >= start)
);

create index if not exists leave_requests_person_start_idx on public.leave_requests(person,start);
create index if not exists leave_requests_status_start_idx on public.leave_requests(status,start);

alter table public.profiles enable row level security;
alter table public.leave_requests enable row level security;

create or replace function public.current_profile_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from profiles where lower(email)=lower(coalesce(auth.jwt()->>'email','')) limit 1
$$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=current_profile_id() and role='manager')
$$;

drop policy if exists profiles_team_read on public.profiles;
create policy profiles_team_read on public.profiles for select to authenticated using (current_profile_id() is not null);
drop policy if exists leave_team_read on public.leave_requests;
create policy leave_team_read on public.leave_requests for select to authenticated using (current_profile_id() is not null and (is_manager() or person=current_profile_id() or status='approved'));

create or replace function public.submit_leave(p_person uuid,p_start date,p_end date,p_note text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare v_me uuid:=current_profile_id();v_target uuid;v_id uuid;v_days int;v_available int;
begin
  if v_me is null then raise exception 'Your email is not on this team.'; end if;
  v_target:=case when is_manager() and p_person is not null then p_person else v_me end;
  if p_start<current_date or p_end<p_start or extract(year from p_start)<>extract(year from p_end) then raise exception 'Choose valid dates in the current leave year.'; end if;
  select count(*) into v_days from generate_series(p_start,p_end,'1 day') as g(day) where extract(isodow from day)<6;
  if v_days<1 or v_days>100 then raise exception 'Select 1 to 100 weekdays.'; end if;
  if exists(select 1 from leave_requests where person=v_target and status in ('pending','approved') and start<=p_end and "end">=p_start) then raise exception 'An active request overlaps these dates.'; end if;
  select p.allowance-p.used-coalesce((select sum((select count(*) from generate_series(r.start,r."end",'1 day') as g(day) where extract(isodow from day)<6)) from leave_requests r where r.person=v_target and r.status='approved' and extract(year from r.start)=extract(year from p_start)),0) into v_available from profiles p where p.id=v_target;
  if v_days>v_available then raise exception 'This request exceeds the available balance.'; end if;
  insert into leave_requests(person,start,"end",note) values(v_target,p_start,p_end,left(coalesce(p_note,''),500)) returning id into v_id;return v_id;
end $$;

create or replace function public.cancel_leave(p_request uuid) returns void language plpgsql security definer set search_path=public as $$
begin update leave_requests set status='cancelled',decided=current_date where id=p_request and person=current_profile_id() and status='pending';if not found then raise exception 'Only your pending request can be cancelled.';end if;end $$;

create or replace function public.decide_leave(p_request uuid,p_decision text,p_note text default '',p_override boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare v leave_requests%rowtype;
begin
  if not is_manager() then raise exception 'Manager access required.';end if;
  select * into v from leave_requests where id=p_request and status='pending' for update;if not found then raise exception 'Request not found or already decided.';end if;
  if v.person=current_profile_id() then raise exception 'A manager cannot approve their own request.';end if;
  if p_decision not in ('approved','declined') then raise exception 'Choose approve or decline.';end if;
  if p_decision='declined' and trim(coalesce(p_note,''))='' then raise exception 'Add a reason before declining.';end if;
  if p_decision='approved' and not p_override and exists(
    select 1 from generate_series(v.start,v."end",'1 day') as g(day)
    where extract(isodow from day)<6 and
      (select count(distinct r.person) from leave_requests r where r.status='approved' and r.start<=day and r."end">=day) >= least(2,greatest(0,(select count(*) from profiles)-1))
  ) then raise exception 'Confirm arranged coverage before approving this conflict.';end if;
  update leave_requests set status=p_decision,decision_note=left(coalesce(p_note,''),500),decided=current_date where id=p_request;
end $$;

create or replace function public.upsert_profile(p_email text default null,p_name text default null,p_allowance integer default 25,p_used integer default 0,p_role text default 'employee',p_id uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not is_manager() then raise exception 'Manager access required.';end if;
  if p_id is null then insert into profiles(email,name,allowance,used,role) values(lower(trim(p_email)),trim(p_name),p_allowance,p_used,p_role) returning id into v_id;
  else update profiles set name=trim(p_name),allowance=p_allowance,used=p_used,role=case when lower(email)='rdaniglad@gmail.com' then 'manager' else p_role end where id=p_id returning id into v_id;end if;
  return v_id;
end $$;

insert into public.profiles(email,name,allowance,used,role)
values('rdaniglad@gmail.com','Daniela Omena',25,0,'manager')
on conflict(email) do update set name=excluded.name,role='manager';

grant execute on function public.submit_leave(uuid,date,date,text) to authenticated;
grant execute on function public.cancel_leave(uuid) to authenticated;
grant execute on function public.decide_leave(uuid,text,text,boolean) to authenticated;
grant execute on function public.upsert_profile(text,text,integer,integer,text,uuid) to authenticated;
revoke execute on function public.submit_leave(uuid,date,date,text) from public,anon;
revoke execute on function public.cancel_leave(uuid) from public,anon;
revoke execute on function public.decide_leave(uuid,text,text,boolean) from public,anon;
revoke execute on function public.upsert_profile(text,text,integer,integer,text,uuid) from public,anon;
