# Team Leave — onboarding checklist (English)

One-page guide for Daniela’s team. Product UI stays in English.

## First access (new teammate)

1. **Admin** opens **Users → Add user** and creates a profile (email + name). Role starts as **Employee** — promote later in **Edit**.
2. Admin shares the **invite link** (Copy invite / Open email). The link includes `?email=` so **Create password** is prefilled.
3. Teammate opens the link → **Create password** → then **Sign in**.
4. Never share a temporary password by email.

## Forgot password vs Create password

| Situation | Use |
| --- | --- |
| Invited, never set a password | **Create password** |
| Already created a password, forgot it | **Forgot password?** or admin **Reset password** |
| Reset email opens Sign in with no set-password screen | Auth URL Configuration is wrong — see `docs/ops-checklist.md` |

## After a password reset email

1. Open the **newest** link from the email (links expire).
2. You should see **Set a new password** (not empty Sign in).
3. Save → **Password saved — continue to workspace**.

## Deactivated accounts

Ask an **admin** to reactivate you on **Users → Edit**. Managers cannot reactivate.

## Managers — request queue habit

Notifications are **in-app only** (no email alerts). Open **Requests** each morning. The badge refreshes about every 45 seconds (Realtime optional in Supabase). Aim to respond within **2 business days**.
