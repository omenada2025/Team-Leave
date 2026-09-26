-- Federal general holidays for federally regulated Canadian workplaces, 2026.
insert into public.holidays(date,name,region) values
  ('2026-01-01','New Year''s Day','Canada — Federal'),
  ('2026-04-03','Good Friday','Canada — Federal'),
  ('2026-05-18','Victoria Day','Canada — Federal'),
  ('2026-07-01','Canada Day','Canada — Federal'),
  ('2026-09-07','Labour Day','Canada — Federal'),
  ('2026-09-30','National Day for Truth and Reconciliation','Canada — Federal'),
  ('2026-10-12','Thanksgiving Day','Canada — Federal'),
  ('2026-11-11','Remembrance Day','Canada — Federal'),
  ('2026-12-25','Christmas Day','Canada — Federal'),
  ('2026-12-26','Boxing Day','Canada — Federal'),
  ('2026-12-28','Boxing Day (observed)','Canada — Federal')
on conflict(date) do update set name=excluded.name,region=excluded.region;
