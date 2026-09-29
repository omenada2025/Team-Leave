# Team Leave — onboarding checklist (English)

One-page guide for Daniela’s team. Product UI stays in English.

## First access (new teammate)

1. **Admin** opens **Users → Add user** (name + email). Role starts as **Employee** — promote later in **Edit**.
2. The app creates the **profile** and an **Auth user** with a **temporary password**.
3. Admin uses **Open email** / **Copy email** to send the temporary password (mailto MVP if SMTP is not wired).
4. Teammate opens the app → **Sign in** with email + temporary password → **must choose a new password** before using the app.

There is no self-serve **Create password** tab.

## Forgot / reset vs first login

| Situation | Use |
| --- | --- |
| New teammate (temp password from admin) | Sign in → forced **Choose a new password** |
| Already set a password, forgot it | **Forgot password?** or admin **Reset password** (recovery email) |
| Reset email opens Sign in with no set-password screen | Auth URL Configuration is wrong — see `docs/ops-checklist.md` |

Admin **Reset password** is separate from the first-login force-change flag.

## After a password reset email

1. Open the **newest** link from the email (links expire).
2. You should see **Set a new password** (not empty Sign in).
3. Save → **Password saved — continue to workspace**.

## Deactivated accounts

Ask an **admin** to reactivate you on **Users → Edit**. Managers cannot reactivate. Deactivated users cannot sign in.

## Managers — request queue habit

Notifications are **in-app only** (no email alerts). Open **Requests** each morning. The badge refreshes about every 45 seconds (Realtime optional in Supabase). Aim to respond within **2 business days**.
