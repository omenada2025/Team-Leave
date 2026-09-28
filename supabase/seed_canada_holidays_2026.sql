-- Ontario Employment Standards Act public holidays for 2026.
-- Run after schema.sql (fresh) or upgrade_workflow.sql (existing) when holidays are missing.
delete from public.holidays where region = 'Canada — Federal';
insert into public.holidays(date,name,region) values
  ('2026-01-01','New Year''s Day','Ontario'),
  ('2026-02-16','Family Day','Ontario'),
  ('2026-04-03','Good Friday','Ontario'),
  ('2026-05-18','Victoria Day','Ontario'),
  ('2026-07-01','Canada Day','Ontario'),
  ('2026-09-07','Labour Day','Ontario'),
  ('2026-10-12','Thanksgiving Day','Ontario'),
  ('2026-12-25','Christmas Day','Ontario'),
  ('2026-12-26','Boxing Day','Ontario'),
  ('2026-12-28','Boxing Day (observed)','Ontario')
on conflict(date) do update set name=excluded.name,region=excluded.region;
