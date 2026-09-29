-- Live hotfix: paste in Supabase SQL Editor when Pages is ahead of the database.
-- Fixes PostgREST "Could not find the function … in the schema cache" for:
--   Create password → is_invited_email(p_email)
--   Users / Edit user → Save → upsert_profile(... p_active ...)
--   Soft-deactivate → set_profile_active
-- Includes helpers those RPCs need (current_profile_id, is_admin, is_manager).
--
-- Preferred path for a fully caught-up project: run supabase/upgrade_workflow.sql
-- (leave/coverage/holiday RPCs, RLS, team_settings, etc.). This file is the
-- smaller emergency paste when invite / Users are broken and you need a quick fix.
-- Safe to re-run. Ends with notify pgrst so the API cache reloads.

-- ── Minimal columns / role check the current client expects ─────────────────
alter table public.profiles add column if not exists team text not null default 'General';
alter table public.profiles add column if not exists manager_email text;
alter table public.profiles add column if not exists active boolean not null default true;

do $$ begin
  alter table public.profiles drop constraint if exists profiles_role_check;
exception when undefined_object then null; end $$;
alter table public.profiles add constraint profiles_role_check
  check (role in ('employee','manager','admin'));

-- ── Helpers (from upgrade_workflow.sql) ─────────────────────────────────────
create or replace function public.current_profile_id() returns uuid
language sql stable security definer set search_path=public as $$
  select id from profiles where lower(email)=lower(coalesce(auth.jwt()->>'email','')) and active limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=current_profile_id() and role='admin' and active)
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=current_profile_id() and role in ('manager','admin') and active)
$$;

-- ── Invite / Create password (callable by anon before signup) ───────────────
create or replace function public.is_invited_email(p_email text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where lower(email)=lower(trim(p_email)) and active)
$$;

-- ── User admin Save + soft-deactivate ───────────────────────────────────────
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
    insert into profiles(email,name,allowance,used,role,team,manager_email,active)
    values(
      lower(trim(p_email)),
      trim(p_name),
      p_allowance,
      p_used,
      p_role,
      coalesce(nullif(trim(p_team),''),'General'),
      nullif(lower(trim(p_manager_email)),''),
      coalesce(p_active, true)
    )
    on conflict(email) do update set
      name = excluded.name,
      allowance = excluded.allowance,
      team = excluded.team,
      manager_email = excluded.manager_email,
      active = true
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.set_profile_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Admin access required.'; end if;
  if p_id = current_profile_id() then raise exception 'You cannot deactivate your own account.'; end if;
  update profiles set active = p_active where id = p_id;
  if not found then raise exception 'User not found.'; end if;
end $$;

-- ── Grants (match schema / upgrade_workflow) ────────────────────────────────
revoke all on function public.is_invited_email(text) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) from public,anon;
revoke all on function public.set_profile_active(uuid,boolean) from public,anon;

grant execute on function public.is_invited_email(text) to anon, authenticated;
grant execute on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) to authenticated;
grant execute on function public.set_profile_active(uuid,boolean) to authenticated;

-- Primary operator can open Users (admin-only).
update public.profiles
set role = 'admin', active = true
where lower(email) = 'rdaniglad@gmail.com';

notify pgrst, 'reload schema';
