# Live ops checklist — Team Leave (English)

**Project:** `skezxxnhsvdrwrdxabje`  
**Pages:** https://omenada2025.github.io/Team-Leave/  
**Dashboard Auth URLs:** [URL Configuration](https://supabase.com/dashboard/project/skezxxnhsvdrwrdxabje/auth/url-configuration)

These steps cannot be completed from the GitHub repo alone. Do them in the Supabase Dashboard / browser. Do not put database passwords in git.

## A. Auth URL Configuration (5 minutes)

| Setting | Value |
| --- | --- |
| **Site URL** | `https://omenada2025.github.io/Team-Leave/` |
| **Redirect URLs** | `https://omenada2025.github.io/Team-Leave/**` |
| | `https://omenada2025.github.io/Team-Leave/` |
| | `https://omenada2025.github.io/Team-Leave` |
| | `https://omenada2025.github.io/Team-Leave/index.html` |
| | `https://omenada2025.github.io/Team-Leave/?reset=1` |

Also: **Authentication → Email Templates → Reset password** must keep `{{ .ConfirmationURL }}`.

Why `?reset=1` + implicit flow: admin-sent resets open on the employee’s device; PKCE would bind the link to Daniela’s browser.

## B. SQL on live (existing project)

In **SQL Editor**, run in order:

1. Prefer `supabase/upgrade_workflow.sql` (idempotent; ends with `notify pgrst, 'reload schema'`).
2. Emergency only: `supabase/hotfix_live_rpcs.sql`, then still run the full upgrade soon.
3. Holiday seed if empty: `supabase/seed_ontario_holidays.sql` (or in-app **Load Ontario**).

Then confirm:

```sql
select email, role, active, used from public.profiles order by name;
-- your row should have role = 'admin'
```

## C. Audit `profiles.used` (carry-in only)

Policy: `available = allowance − used − approved Vacation`. If `used` already included approved days, reset carry-in after review:

```sql
-- Inspect
select p.email, p.used as carry_in, coalesce(sum(
  case when lr.status = 'approved' and lr.type = 'Vacation'
    and extract(year from lr.start) = extract(year from current_date)
  then public.leave_duration(lr.start, lr.end, lr.portion) else 0 end
), 0) as approved_vacation
from public.profiles p
left join public.leave_requests lr on lr.person = p.id
group by p.id order by p.email;
```

## D. 10-minute smoke after each merge to `main`

- [ ] Auth URLs match section A
- [ ] Create password with invite `?email=`
- [ ] Forgot / admin Reset → **Set a new password**
- [ ] Approve a pending request
- [ ] Users → Edit → Save
- [ ] Mobile: Sign out / Password visible in the top bar (≤700px)
- [ ] Manager: Edit/Cancel on **own** pending request

## Optional

- Enable **Realtime** for `leave_requests` and `notifications` (app also polls ~45s).
- Confirm Users badges (“Never signed in” / “Has Auth”) after upgrade (`list_profile_auth_status`).
