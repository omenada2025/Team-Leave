-- Emergency paste: fixes Edit user → Save when live PostgREST cannot find
-- public.upsert_profile(p_active, p_allowance, p_id, p_manager_email, p_name, p_role, p_team, p_used).
-- Prefer running the full supabase/upgrade_workflow.sql when you can.
-- Safe to re-run.

alter table public.profiles add column if not exists team text not null default 'General';
alter table public.profiles add column if not exists manager_email text;
alter table public.profiles add column if not exists active boolean not null default true;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id = (
    select id from profiles where lower(email)=lower(coalesce(auth.jwt()->>'email','')) and active limit 1
  ) and role = 'manager' and active)
$$;

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
  if not is_manager() then raise exception 'Manager access required.'; end if;
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

revoke all on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) from public,anon;
grant execute on function public.upsert_profile(text,text,integer,integer,text,uuid,text,text,boolean) to authenticated;

notify pgrst, 'reload schema';
