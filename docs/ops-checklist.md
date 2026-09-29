# Live ops checklist — Team Leave (English)

**Project:** `skezxxnhsvdrwrdxabje`  
**Pages:** https://omenada2025.github.io/Team-Leave/  
**Dashboard Auth URLs:** [URL Configuration](https://supabase.com/dashboard/project/skezxxnhsvdrwrdxabje/auth/url-configuration)

These steps cannot be completed from the GitHub repo alone. Do them in the Supabase Dashboard / browser. Do not put database passwords or service role keys in git.

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

### Set Auth email templates (subjects + Team Leave branding)

Paste product-named subjects and HTML from [`docs/email-templates/`](email-templates/README.md) (start with **Reset password**: subject `Team Leave — Reset your password`). Full paste guide: [Email Templates](https://supabase.com/dashboard/project/skezxxnhsvdrwrdxabje/auth/templates). Optional Custom SMTP sender display name: **`Team Leave`**.

Why `?reset=1` + implicit flow: admin-sent resets open on the employee’s device; PKCE would bind the link to Daniela’s browser.

### Auth settings for temporary passwords

- Prefer deploying Edge Function **`admin-create-user`** (auto-confirms email).
- If using the client **signUp fallback** instead: **Authentication → Providers → Email → Confirm email** should be **off**, or new users cannot sign in until they confirm.
- Keep email/password sign-in enabled. Do not rely on self-serve signup for access — admins create users.

## B. SQL on live (existing project)

In **SQL Editor**, run in order:

1. Prefer `supabase/upgrade_workflow.sql` (idempotent; ends with `notify pgrst, 'reload schema'`). Includes `must_change_password` and coverage conflict fixes.
2. Focused paste only (password): `supabase/hotfix_must_change_password.sql`.
3. Coverage conflict only (Review/Approve false “No conflict”): `supabase/hotfix_coverage_conflict.sql`, then still run the full upgrade soon.
4. Emergency older catch-up: `supabase/hotfix_live_rpcs.sql`, then still run the full upgrade soon.
5. Holiday seed if empty: `supabase/seed_ontario_holidays.sql` (or in-app **Load Ontario**).

Then confirm:

```sql
select email, role, active, must_change_password, used from public.profiles order by name;
-- your row should have role = 'admin'
```

## C. Edge Function (Auth create + optional auto-email)

Creates / resets Auth users with a temporary password using the **service role**, then emails the branded welcome message when a mail provider secret is set.

1. Install [Supabase CLI](https://supabase.com/docs/guides/cli) and log in.
2. Dashboard → **Project Settings → API** → copy **service_role** secret.
3. Set secrets (do not commit):

```bash
# Required
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY --project-ref skezxxnhsvdrwrdxabje

# Required for automatic invite email (pick one provider)
supabase secrets set RESEND_API_KEY=re_xxx --project-ref skezxxnhsvdrwrdxabje
# Optional From (verify domain in Resend; default is onboarding@resend.dev for tests)
supabase secrets set RESEND_FROM='Team Leave <onboarding@yourdomain.com>' --project-ref skezxxnhsvdrwrdxabje

# OR SendGrid instead of Resend:
# supabase secrets set SENDGRID_API_KEY=SG.xxx SENDGRID_FROM='Team Leave <noreply@yourdomain.com>' --project-ref skezxxnhsvdrwrdxabje
```

4. Deploy (re-deploy after any secret change so the function picks them up):

```bash
supabase functions deploy admin-create-user --project-ref skezxxnhsvdrwrdxabje
```

5. Source: `supabase/functions/admin-create-user/index.ts`

### What the UI shows

| Result | Modal |
| --- | --- |
| Mail provider sent OK | Green **Email sent** — mailto is backup only |
| No `RESEND_API_KEY` / `SENDGRID_API_KEY` | Yellow **Automatic email not configured** + **Open email** / **Copy** |
| Provider error | Yellow **Email was not sent** + reason + mailto still available |
| Client `signUp` fallback (function missing) | Yellow **Automatic email unavailable** — never auto-sends temp password |

Without the function, Add user still tries **client signUp** and never SMTP-sends the temp password. Resend invite for an existing Auth user needs the Edge Function (or admin **Reset password** recovery email).

### Auth settings that can block sign-in (not the welcome mail)

- Edge Function path auto-confirms email (`email_confirm: true`) — Confirm email can stay on.
- Client signUp fallback: turn **Confirm email** **off**, or new users cannot sign in until they confirm.
- Supabase Auth **Invite user** / Custom SMTP is a different flow (invite link, not our temp-password email). Prefer Resend/SendGrid on this Edge Function for the product flow Daniela expects.

## D. Audit `profiles.used` (carry-in only)

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

## E. 10-minute smoke after each merge to `main`

- [ ] Auth URLs match section A
- [ ] Email templates: Reset password subject starts with **Team Leave —** (see `docs/email-templates/`)
- [ ] SQL: `must_change_password` column + RPCs applied
- [ ] Users → Add user → modal shows **Email sent** (if Resend/SendGrid configured) **or** unmistakable **Automatic email not configured / was not sent** + Open email / Copy
- [ ] Subject is `Team Leave — Your temporary password`
- [ ] Sign in with temp password → blocked until **Choose a new password**
- [ ] Forgot / admin Reset → **Set a new password** (recovery, separate from force-change)
- [ ] Deactivated user cannot sign in
- [ ] Approve a pending request
- [ ] Users → Edit → Save
- [ ] Mobile: Sign out / Password visible in the top bar (≤700px)

## Optional

- Enable **Realtime** for `leave_requests` and `notifications` (app also polls ~45s).
- Confirm Users badges (“Never signed in” / “Has Auth”) — RPC `list_profile_auth_status` is live; badges appear for admins when the call succeeds.
