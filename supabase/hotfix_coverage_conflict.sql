-- Live hotfix: coverage conflict detection for Review / decide_leave / client math.
-- Paste in Supabase SQL Editor (project skezxxnhsvdrwrdxabje) when Pages ships the
-- coverage UI before a full `upgrade_workflow.sql` run.
--
-- Changes:
--   1) Auto minimum: ≤3 active people → n−1 (at most one away); else n−2
--   2) has_coverage_conflict counts pending + approved (excludes WFH)
-- Safe to re-run. Ends with notify pgrst.
-- Prefer full `upgrade_workflow.sql` when you can (includes employee self-only message).

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

notify pgrst, 'reload schema';
