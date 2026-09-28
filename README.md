# Team Leave

Private team leave planner for Daniela’s team: balances, request/approve workflow, coverage checks, calendar, holidays, and in-app notifications.

**Live stack:** GitHub Pages (`dist/`) + Supabase Auth / Postgres.

An older OpenAI Sites worker + D1 path was retired from this repo so it cannot be mistaken for production.

## Operator setup

### Fresh Supabase project

1. Create a project in Supabase.
2. In **SQL Editor**, run in order:
   1. `supabase/schema.sql` — full current schema (profiles, leave_requests with portion/types, holidays, notifications, RPCs with decision/balance guards).
   2. `supabase/seed_canada_holidays_2026.sql` — Ontario 2026 public holidays.
3. **Authentication → URL configuration**
   - Site URL: your GitHub Pages URL (e.g. `https://<org>.github.io/Team-Leave/`).
   - Redirect URLs: add that same Pages URL (with and without trailing slash if you use both).
4. Confirm the publishable key and project URL in `dist/app.mjs` match this project (or update them).
5. Push to `main`; GitHub Actions deploys the `dist/` folder to Pages.

### Existing Supabase project (already deployed)

1. In **SQL Editor**, run `supabase/upgrade_workflow.sql` (idempotent). This restores:
   - Self-approval block in `decide_leave`
   - Coverage conflict checks honoring `p_override`
   - Vacation-only balance checks on submit/update/decide
   - Holiday-aware weekday × portion math
   - `is_invited_email` for profile-first signup
2. If the holidays table is empty, run `supabase/seed_canada_holidays_2026.sql`.
3. Deploy the updated `dist/` (merge/push this branch).

Do **not** run `supabase/add_work_from_home.sql` — it is obsolete; WFH is included in schema/upgrade.

## Leave balance rules

- Only **Vacation** deducts from the annual vacation balance.
- **Work From Home**, **Sick**, **Personal**, and **Unpaid** do not burn vacation days.
- `profiles.used` is **carry-in / manual adjustment only**. Do not enter the sum of approved requests there — available days = `allowance − used − approved Vacation (holiday-aware, including half-days)`.
- Coverage minimum = `max(1, headcount − 2)`. Approving below that requires the override checkbox (`p_override`).

## Inviting teammates

1. A manager uses **Add user** to create a **profile** (email must match their work address). No Auth user or temporary password is created by the app.
2. Share the app link. The teammate opens Team Leave → **Create password** with that same email.
3. Signup calls `is_invited_email` first; emails not on `profiles` are rejected.
4. Optional (Dashboard): Authentication → Users → Invite user with the same email. Prefer this if you want Supabase to send the invite email. Never put passwords in email bodies.

There is no service-role key in the frontend. Admin invite from the app would need a Supabase Edge Function or Dashboard action — not shipped here.

## Auth notes

- Sign-in: email + password for addresses already on the team.
- Create password: only after a manager added the profile.
- Forgot password: Supabase reset email (redirect must be allow-listed).
- Access after Auth still requires a matching `profiles` row (RLS + client gate).

## What managers enforce in SQL

`submit_leave` / `update_leave` / `decide_leave` are `security definer` RPCs. Client checks are UX only; the database blocks:

- Overlapping active requests
- Over-balance Vacation
- Self-approval
- Coverage conflicts unless `p_override` is true

## Files

| Path | Role |
| --- | --- |
| `dist/` | Deployed SPA (Pages) |
| `supabase/schema.sql` | Greenfield install |
| `supabase/upgrade_workflow.sql` | Existing-project upgrade |
| `supabase/seed_canada_holidays_2026.sql` | Holiday seed |
| `.github/workflows/pages.yml` | Pages deploy |

## Retired

Previous `worker/`, `drizzle/`, `.openai/`, and `scripts/embed.mjs` paths for OpenAI Sites + D1 were removed. Do not resurrect them alongside Pages + Supabase.
