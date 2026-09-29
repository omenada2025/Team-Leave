-- Hotfix: must_change_password for admin-created users + force change on first login.
-- Run in SQL Editor on project skezxxnhsvdrwrdxabje after deploying the matching Pages build.
-- Prefer full upgrade_workflow.sql when catching up; this file is the focused paste.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- New invites / re-adds start with force-change; Edit user Save leaves the flag alone.
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

-- Caller clears their own flag after setting a new password (first login or Change password).
create or replace function public.clear_must_change_password()
returns void language plpgsql security definer set search_path=public as $$
begin
  update profiles
  set must_change_password = false
  where id = current_profile_id();
  if not found then raise exception 'Profile not found.'; end if;
end $$;

-- Admin can re-flag (e.g. after regenerating a temporary password).
create or replace function public.set_must_change_password(p_id uuid, p_value boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Admin access required.'; end if;
  update profiles set must_change_password = coalesce(p_value, true) where id = p_id;
  if not found then raise exception 'User not found.'; end if;
end $$;

revoke all on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) from public,anon;
revoke all on function public.clear_must_change_password() from public,anon;
revoke all on function public.set_must_change_password(uuid,boolean) from public,anon;

grant execute on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
grant execute on function public.set_must_change_password(uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
