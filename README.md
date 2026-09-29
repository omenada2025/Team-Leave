# Team Leave

Private team leave planner for Daniela’s team: balances, request/approve workflow, coverage checks, calendar, holidays, and **in-app notifications only** (no email sender).

**Live stack:** GitHub Pages (`dist/`) + Supabase Auth / Postgres.

Editable source lives in `src/`. Run `bash scripts/build.sh` to copy into `dist/` before deploy (CI and Pages do this automatically).

## Operator setup

### Fresh Supabase project

1. Create a project in Supabase.
2. In **SQL Editor**, run in order:
   1. `supabase/schema.sql` — full current schema.
   2. `supabase/seed_ontario_holidays.sql` — Ontario ESA holidays 2026–2028 (or use **Load Ontario holidays** in Reports after login).
3. **Authentication → URL configuration**
   - Site URL: your GitHub Pages URL (e.g. `https://<org>.github.io/Team-Leave/`).
   - Redirect URLs: add that same Pages URL (with and without trailing slash if you use both).
4. Confirm the publishable key and project URL in `src/app.mjs` (then rebuild) match this project.
5. Push to `main`; GitHub Actions runs verify checks, then deploys `dist/` to Pages.

### Existing Supabase project (already deployed)

1. In **SQL Editor**, run `supabase/upgrade_workflow.sql` (idempotent; ends with `notify pgrst, 'reload schema'`). This adds:
   - `upsert_profile(..., p_active)` matching Edit user → Save
   - `is_invited_email` for **Create password**
   - Team-scoped `decide_leave` / RLS (`manages_person`)
   - Configurable `team_settings.minimum_coverage`
   - Soft-deactivate (`profiles.active` / `set_profile_active`)
   - Holiday delete + region on upsert
   - Year rollover RPC (`rollover_leave_year`, carry-over = 0)
   - Drops unused `email_events` (in-app notifications only)
   - Self-approval / coverage / Vacation balance guards (as before)
2. If holidays are incomplete, run `supabase/seed_ontario_holidays.sql` (or Load Ontario in the app).
3. Deploy the updated app (merge/push this branch).

Do **not** run `supabase/add_work_from_home.sql` — it is obsolete.

**When live Supabase is behind Pages** (schema-cache 404s such as `is_invited_email` or `upsert_profile(...p_active...)`):

1. Prefer `supabase/upgrade_workflow.sql` (full catch-up).
2. If you only need invite + Users unblocked quickly, paste `supabase/hotfix_live_rpcs.sql` in the SQL Editor, then still run the full upgrade soon.
3. `supabase/hotfix_upsert_profile.sql` is Save-only and superseded by `hotfix_live_rpcs.sql`.

### SQL / ops Daniela must still do on live Supabase

These cannot be done from the repo alone:

1. **Run `upgrade_workflow.sql`** (preferred) **or** at minimum `hotfix_live_rpcs.sql` so Create password + Users Save work — then holiday seed if needed.
2. **Audit `profiles.used`** after the balance policy: if `used` already included approved Vacation, reset carry-in so balances are not double-counted (`available = allowance − used − approved Vacation`).
3. Optionally enable **Realtime** for `leave_requests` and `notifications` in the Supabase dashboard (the app also polls every ~45s as a fallback).

## Leave balance rules

- Only **Vacation** deducts from the annual vacation balance.
- **Work From Home**, **Sick**, **Personal**, and **Unpaid** do not burn vacation days.
- `profiles.used` is **carry-in / manual adjustment only**.
- **Carry-over default = 0** — unused vacation does not roll into the next year. At year start, managers use Reports → Reset carry-in (or `rollover_leave_year`) to set `used` to 0 for their team. Approved leave history is kept.
- Coverage minimum defaults to `max(1, active_headcount − 2)`. Managers can set an absolute minimum in Reports. Approving below that requires the override checkbox (`p_override`).

## Manager team scope

Managers only **see pending/decide** requests for people on the **same `team`** or whose **`manager_email`** matches the manager’s email. Approved absences remain visible on the shared calendar. There is no separate `admin` role.

## Notifications

**In-app only.** The dead `email_events` path was removed. Opening Notifications marks items read and refreshes the unread badge. No Resend (or other) API keys are required.

## Inviting teammates

1. A manager uses **Add user** to create a **profile** (no Auth user / temp password).
2. Share the app link → teammate uses **Create password** with that email.
3. Signup calls `is_invited_email` (active profiles only).
4. Keep **Email** signup enabled in Supabase Auth, or invite from the Dashboard. Never put passwords in email bodies.

## Soft-deactivate users

Admins can uncheck **Active** on Edit user. Deactivated people stay in history, drop out of coverage headcount, and cannot Create password / open the app. Prefer this over deleting profiles.

## Users page (admin only)

Only profiles with `role = 'admin'` see **Users** in the nav. Managers keep leave approval / reports; they cannot open the directory, upsert profiles, or deactivate users (RPCs raise `Admin access required`). Non-admins who somehow hit Users see a clear restricted message. Change password lives in the sidebar for everyone.

The upgrade promotes `rdaniglad@gmail.com` to `admin`. To grant another admin after upgrade:

```sql
update public.profiles set role = 'admin', active = true where lower(email) = 'someone@company.com';
```

## Holidays

Reports → **Manage holidays**: add / edit / delete, or **Load Ontario** for the current/next year. Calendar day panel and cell `aria-label` show the holiday **name**.

## Auth notes

- Sign-in: email + password for active team profiles.
- Create password: only after a manager added (and activated) the profile.
- Forgot password / **Edit user → Reset password** (admin only): Supabase `resetPasswordForEmail` (no temporary passwords). Redirect must be allow-listed to the Pages URL.
- Admin Reset password sends the link to that user’s profile email; success/error feedback stays in the Edit user modal.

## What managers enforce in SQL

`submit_leave` / `update_leave` / `decide_leave` are `security definer` RPCs. The database blocks:

- Overlapping active requests
- Over-balance Vacation
- Self-approval
- Coverage conflicts unless `p_override` is true
- Decisions outside the manager’s team scope

## Local checks

```bash
bash scripts/build.sh
node scripts/test-logic.mjs
node scripts/test-sql.mjs
```

## Files

| Path | Role |
| --- | --- |
| `src/` | Editable SPA source |
| `dist/` | Built copy deployed to Pages |
| `supabase/schema.sql` | Greenfield install |
| `supabase/upgrade_workflow.sql` | Existing-project upgrade (preferred) |
| `supabase/hotfix_live_rpcs.sql` | Emergency paste when live is behind Pages (invite + Users RPCs) |
| `supabase/hotfix_upsert_profile.sql` | Narrower Save-only paste (superseded by hotfix_live_rpcs) |
| `supabase/seed_ontario_holidays.sql` | Holiday seed 2026–2028 |
| `.github/workflows/ci.yml` | PR/main logic + SQL checks |
| `.github/workflows/pages.yml` | Verify then deploy Pages |

## Retired

Previous `worker/`, `drizzle/`, `.openai/`, and `scripts/embed.mjs` paths for OpenAI Sites + D1 were removed. Do not resurrect them alongside Pages + Supabase.
