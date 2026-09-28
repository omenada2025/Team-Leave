-- Ontario ESA public holidays (2026–2028).
-- Run after schema.sql (fresh) or upgrade_workflow.sql (existing) when holidays are missing,
-- or use “Load Ontario holidays” in the Reports page (managers).
-- Replaces the older seed_canada_holidays_2026.sql name — that file now points here.

delete from public.holidays where region in ('Canada — Federal', 'Ontario');
insert into public.holidays(date,name,region) values
  -- 2026
  ('2026-01-01','New Year''s Day','Ontario'),
  ('2026-02-16','Family Day','Ontario'),
  ('2026-04-03','Good Friday','Ontario'),
  ('2026-05-18','Victoria Day','Ontario'),
  ('2026-07-01','Canada Day','Ontario'),
  ('2026-09-07','Labour Day','Ontario'),
  ('2026-10-12','Thanksgiving Day','Ontario'),
  ('2026-12-25','Christmas Day','Ontario'),
  ('2026-12-26','Boxing Day','Ontario'),
  ('2026-12-28','Boxing Day (observed)','Ontario'),
  -- 2027
  ('2027-01-01','New Year''s Day','Ontario'),
  ('2027-02-15','Family Day','Ontario'),
  ('2027-03-26','Good Friday','Ontario'),
  ('2027-05-24','Victoria Day','Ontario'),
  ('2027-07-01','Canada Day','Ontario'),
  ('2027-09-06','Labour Day','Ontario'),
  ('2027-10-11','Thanksgiving Day','Ontario'),
  ('2027-12-25','Christmas Day','Ontario'),
  ('2027-12-26','Boxing Day','Ontario'),
  ('2027-12-27','Christmas Day (observed)','Ontario'),
  ('2027-12-28','Boxing Day (observed)','Ontario'),
  -- 2028
  ('2028-01-01','New Year''s Day','Ontario'),
  ('2028-02-21','Family Day','Ontario'),
  ('2028-04-14','Good Friday','Ontario'),
  ('2028-05-22','Victoria Day','Ontario'),
  ('2028-07-01','Canada Day','Ontario'),
  ('2028-09-04','Labour Day','Ontario'),
  ('2028-10-09','Thanksgiving Day','Ontario'),
  ('2028-12-25','Christmas Day','Ontario'),
  ('2028-12-26','Boxing Day','Ontario')
on conflict(date) do update set name=excluded.name,region=excluded.region;
