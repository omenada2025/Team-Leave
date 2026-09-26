-- Add Work From Home to the existing request workflow.
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
  if exists(select 1 from leave_requests where person=p_person and status in ('pending','approved') and daterange(start,"end",'[]') && daterange(p_start,p_end,'[]')) then raise exception 'This request overlaps an existing request'; end if;
  select * into v_person from profiles where id=p_person;
  insert into leave_requests(person,start,"end",type,portion,status,note,submitted) values(p_person,p_start,p_end,p_type,p_portion,'pending',coalesce(p_note,''),now()) returning id into v_id;
  insert into notifications(recipient_email,title,message) select email,'New request',v_person.name||' submitted a '||p_type||' request.' from profiles where role='manager' and (team=v_person.team or lower(email)=lower(coalesce(v_person.manager_email,'')));
  insert into email_events(event,recipient_email,payload) select 'request_submitted',email,jsonb_build_object('request_id',v_id,'employee',v_person.name,'type',p_type) from profiles where role='manager' and (team=v_person.team or lower(email)=lower(coalesce(v_person.manager_email,'')));
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
  if exists(select 1 from leave_requests where person=v_person and id<>p_request and status in ('pending','approved') and daterange(start,"end",'[]') && daterange(p_start,p_end,'[]')) then raise exception 'This request overlaps an existing request'; end if;
  update leave_requests set start=p_start,"end"=p_end,note=coalesce(p_note,''),type=p_type,portion=p_portion,submitted=now() where id=p_request;
end $$;
