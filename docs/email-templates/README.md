# Team Leave — Supabase Auth email templates

English copy for **Supabase Dashboard → Authentication → Email Templates** on project `skezxxnhsvdrwrdxabje`.

These subjects and bodies name **Team Leave** so recipients do not mistake the message for phishing or a generic Supabase notice.

**Live app:** https://omenada2025.github.io/Team-Leave/

## Subjects (copy exactly)

| Dashboard template | Subject |
| --- | --- |
| Reset password | `Team Leave — Reset your password` |
| Confirm signup | `Team Leave — Confirm your email` |
| Magic Link | `Team Leave — Your sign-in link` |
| Invite user | `Team Leave — You're invited` |
| Change Email Address | `Team Leave — Confirm your new email` |

Optional (not a Dashboard Auth template — paste into mailto / Custom SMTP if you send a temp password yourself):

| Use | Subject |
| --- | --- |
| Welcome / temporary password | `Team Leave — Your temporary password` |

## How to apply in Supabase Dashboard

1. Open [Email Templates](https://supabase.com/dashboard/project/skezxxnhsvdrwrdxabje/auth/templates).
2. For each template you use (at minimum **Reset password**):
   - Paste the **Subject** from the table above.
   - Open the matching `*.html` file in this folder and paste the full HTML into the **Body** field.
   - Keep every `{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, and other Go template vars unchanged.
3. Save.

### Site URL / Redirect URLs (required for links to work)

[URL Configuration](https://supabase.com/dashboard/project/skezxxnhsvdrwrdxabje/auth/url-configuration):

| Setting | Value |
| --- | --- |
| **Site URL** | `https://omenada2025.github.io/Team-Leave/` |
| **Redirect URLs** | include `https://omenada2025.github.io/Team-Leave/**` and `https://omenada2025.github.io/Team-Leave/?reset=1` |

See `docs/ops-checklist.md` for the full list.

### Sender display name (Custom SMTP)

If you configure Custom SMTP, set the **from / display name** to **`Team Leave`** (not a bare noreply address alone). Recipients trust a named product more than `supabase.io` defaults.

Default Supabase mail still works with these bodies; Custom SMTP only improves deliverability and sender branding.

## Files

| File | Dashboard slot |
| --- | --- |
| `reset-password.html` / `.txt` | Reset password |
| `confirm-signup.html` / `.txt` | Confirm signup |
| `magic-link.html` / `.txt` | Magic Link |
| `invite-user.html` / `.txt` | Invite user |
| `change-email.html` / `.txt` | Change Email Address |
| `welcome-temp-password.html` / `.txt` | **Wired in the app** — Add user / Resend invite → Copy email / Open email (`src/invite-email.mjs`). Also a Custom SMTP paste aid. Placeholders in the static files: `{{TEMP_PASSWORD}}`, `{{EMAIL}}`, `{{APP_URL}}` |

Plain-text (`.txt`) files are for Custom SMTP multipart or ready-to-read review. The Dashboard Body field expects the HTML version.

## Trust notes for operators

- Never replace `{{ .ConfirmationURL }}` with a shortened URL or a bare Pages URL without the Auth token.
- The CTA opens a `*.supabase.co` confirm link that then redirects to GitHub Pages Team Leave — that hop is normal.
- Body copy mentions **https://omenada2025.github.io/Team-Leave/** so people can match the destination.
- Do not use urgent or scare language (“act now”, “account locked”).

## Which templates Team Leave actually sends today

| Flow | Typical template |
| --- | --- |
| Forgot password / admin **Reset password** | **Reset password** (required) |
| Admin Add user with Edge Function (auto-confirm) | No Auth confirmation email; admin **Copy email / Open email** uses `welcome-temp-password` subject/body from `src/invite-email.mjs` |
| Client `signUp` fallback (Confirm email **on**) | **Confirm signup** |
| Auth **Invite user** (Dashboard / Admin API) | **Invite user** |
| Magic link sign-in (if enabled) | **Magic Link** |
| User changes email in Auth | **Change Email Address** |

Full runbook: store doc `docs/supabase-email-templates.md` (Cursor Project) and `docs/ops-checklist.md` in this repo.
