// Supabase Edge Function: admin-create-user
// Creates or resets an Auth user with a temporary password (service role),
// then optionally emails the welcome / temp-password message.
//
// Secrets (Dashboard → Edge Functions → Secrets, never commit):
//   SUPABASE_SERVICE_ROLE_KEY  (required)
//   RESEND_API_KEY             (optional — preferred auto-send)
//   RESEND_FROM                (optional — e.g. "Team Leave <onboarding@yourdomain.com>")
//   SENDGRID_API_KEY           (optional — alternative to Resend)
//   SENDGRID_FROM              (optional — verified SendGrid sender)
//   INVITE_FROM                (optional — shared From for either provider)
//   APP_URL                    (optional — defaults to GitHub Pages app URL)
//
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform.
// Deploy: supabase functions deploy admin-create-user --project-ref skezxxnhsvdrwrdxabje

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ACCESS_EMAIL_SUBJECT = 'Team Leave — Your temporary password';
const DEFAULT_APP_URL = 'https://omenada2025.github.io/Team-Leave/';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const generateTempPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out + 'Aa1!';
};

const escapeHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
  );

/** Plain text — keep aligned with docs/email-templates/welcome-temp-password.txt */
const welcomeText = (email: string, password: string, appUrl: string) =>
  `Team Leave — Your temporary password\n\n` +
  `An admin added you to Team Leave\n` +
  `(${DEFAULT_APP_URL}).\n\n` +
  `1. Open: ${appUrl}\n` +
  `2. Sign in with:\n` +
  `   Email: ${email}\n` +
  `   Temporary password: ${password}\n` +
  `3. You will be asked to choose a new password before using the app.\n\n` +
  `Do not forward this email. If you did not expect access, tell your admin.\n\n` +
  `— Team Leave · Daniela’s team (Zenatech)`;

/** HTML — keep aligned with docs/email-templates/welcome-temp-password.html */
const welcomeHtml = (email: string, password: string, appUrl: string) => {
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const safeApp = escapeHtml(appUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Team Leave — Your temporary password</title>
</head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8fa;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e9ebef;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 4px;font-size:11px;letter-spacing:1.6px;font-weight:700;color:#8a91a2;text-transform:uppercase;">Team Leave</p>
              <h1 style="margin:8px 0 12px;font-size:22px;line-height:1.25;color:#242342;font-weight:700;">Your temporary password</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#505767;">
                An admin added you to <strong>Team Leave</strong>
                (<a href="https://omenada2025.github.io/Team-Leave/" style="color:#6250ac;text-decoration:underline;">omenada2025.github.io/Team-Leave</a>).
                Sign in with the temporary password below, then choose a new password before using the app.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#f8f8fb;border:1px solid #f0f0f5;border-radius:8px;">
                <tr>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#505767;">
                    <p style="margin:0 0 8px;"><strong>App:</strong> <a href="${safeApp}" style="color:#6250ac;">${safeApp}</a></p>
                    <p style="margin:0 0 8px;"><strong>Email:</strong> ${safeEmail}</p>
                    <p style="margin:0;"><strong>Temporary password:</strong> <code style="font-size:14px;color:#242342;">${safePassword}</code></p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 28px;">
                <a href="${safeApp}" style="display:inline-block;background:#6250ac;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 20px;border-radius:8px;">
                  Open Team Leave
                </a>
              </p>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#687083;font-family:Arial,Helvetica,sans-serif;">
                Do not forward this email. If you did not expect access, tell your admin and ignore these credentials.
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#8a91a2;font-family:Arial,Helvetica,sans-serif;">
                — Team Leave · Daniela’s team (Zenatech)
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

type EmailResult = {
  emailSent: boolean;
  emailStatus: 'sent' | 'not_configured' | 'failed';
  emailError?: string;
  emailProvider?: 'resend' | 'sendgrid';
};

async function sendWelcomeEmail(
  to: string,
  password: string,
  appUrl: string,
): Promise<EmailResult> {
  const resendKey = (Deno.env.get('RESEND_API_KEY') || '').trim();
  const sendgridKey = (Deno.env.get('SENDGRID_API_KEY') || '').trim();
  const sharedFrom = (Deno.env.get('INVITE_FROM') || '').trim();
  const resendFrom =
    (Deno.env.get('RESEND_FROM') || '').trim() ||
    sharedFrom ||
    'Team Leave <onboarding@resend.dev>';
  const sendgridFrom =
    (Deno.env.get('SENDGRID_FROM') || '').trim() || sharedFrom;

  const text = welcomeText(to, password, appUrl);
  const html = welcomeHtml(to, password, appUrl);

  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [to],
          subject: ACCESS_EMAIL_SUBJECT,
          text,
          html,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        return {
          emailSent: false,
          emailStatus: 'failed',
          emailProvider: 'resend',
          emailError: `Resend HTTP ${res.status}: ${detail.slice(0, 400)}`,
        };
      }
      return { emailSent: true, emailStatus: 'sent', emailProvider: 'resend' };
    } catch (err) {
      return {
        emailSent: false,
        emailStatus: 'failed',
        emailProvider: 'resend',
        emailError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (sendgridKey) {
    if (!sendgridFrom) {
      return {
        emailSent: false,
        emailStatus: 'not_configured',
        emailError:
          'SENDGRID_API_KEY is set but SENDGRID_FROM (or INVITE_FROM) is missing.',
      };
    }
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: {
            email: sendgridFrom.includes('<')
              ? sendgridFrom.replace(/^.*<([^>]+)>.*$/, '$1').trim()
              : sendgridFrom,
            name: sendgridFrom.includes('<')
              ? sendgridFrom.replace(/<[^>]+>/, '').trim() || 'Team Leave'
              : 'Team Leave',
          },
          subject: ACCESS_EMAIL_SUBJECT,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: html },
          ],
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        return {
          emailSent: false,
          emailStatus: 'failed',
          emailProvider: 'sendgrid',
          emailError: `SendGrid HTTP ${res.status}: ${detail.slice(0, 400)}`,
        };
      }
      return { emailSent: true, emailStatus: 'sent', emailProvider: 'sendgrid' };
    } catch (err) {
      return {
        emailSent: false,
        emailStatus: 'failed',
        emailProvider: 'sendgrid',
        emailError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    emailSent: false,
    emailStatus: 'not_configured',
    emailError:
      'No mail provider configured. Set RESEND_API_KEY (+ optional RESEND_FROM) or SENDGRID_API_KEY + SENDGRID_FROM on the Edge Function, then redeploy. Until then use Open email / Copy.',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: 'Server misconfigured: missing Supabase secrets.' });
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'Missing Authorization bearer token.' });
  }

  let payload: {
    email?: string;
    name?: string;
    password?: string;
    appUrl?: string;
    sendEmail?: boolean;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  if (!email || !email.includes('@')) return json(400, { error: 'Valid email is required.' });

  const appUrl = String(payload.appUrl || Deno.env.get('APP_URL') || DEFAULT_APP_URL)
    .trim()
    .replace(/[?#].*$/, '') || DEFAULT_APP_URL;
  const wantEmail = payload.sendEmail !== false;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.email) {
    return json(401, { error: 'Invalid or expired session.' });
  }

  const { data: isAdmin, error: adminError } = await userClient.rpc('is_admin');
  if (adminError) {
    // Fallback: read profiles if is_admin RPC shape differs
    const { data: profile } = await userClient
      .from('profiles')
      .select('role,active')
      .eq('email', userData.user.email.toLowerCase())
      .maybeSingle();
    if (!profile || profile.role !== 'admin' || profile.active === false) {
      return json(403, { error: 'Admin access required.' });
    }
  } else if (!isAdmin) {
    return json(403, { error: 'Admin access required.' });
  }

  const password =
    typeof payload.password === 'string' && payload.password.length >= 8
      ? payload.password
      : generateTempPassword();

  let created = false;
  const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { full_name: name } : undefined,
    app_metadata: { must_change_password: true },
  });

  if (createError) {
    const already =
      /already\s+(been\s+)?registered|already exists|duplicate|user already/i.test(
        createError.message || '',
      );
    if (!already) return json(500, { error: createError.message });

    // Look up existing user to reset password (paginate a bit).
    let existingId: string | null = null;
    for (let page = 1; page <= 10 && !existingId; page++) {
      const { data: listed, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listError) return json(500, { error: listError.message });
      const hit = (listed?.users || []).find((u) => (u.email || '').toLowerCase() === email);
      if (hit) existingId = hit.id;
      if (!(listed?.users || []).length) break;
    }
    if (!existingId) {
      return json(500, {
        error: 'Auth user appears to exist but could not be found to reset the password.',
      });
    }
    const { error: updError } = await admin.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    });
    if (updError) return json(500, { error: updError.message });
  } else {
    created = !!createdUser?.user;
  }

  // Flag profile so the SPA can block until password change (source of truth).
  const { error: flagError } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('email', email);
  if (flagError) {
    console.warn('could not set must_change_password on profile', flagError.message);
  }

  let emailResult: EmailResult = {
    emailSent: false,
    emailStatus: 'not_configured',
    emailError: 'Email send skipped.',
  };
  if (wantEmail) {
    emailResult = await sendWelcomeEmail(email, password, appUrl);
  }

  return json(200, {
    ok: true,
    created,
    password,
    email,
    emailSent: emailResult.emailSent,
    emailStatus: emailResult.emailStatus,
    emailError: emailResult.emailError || null,
    emailProvider: emailResult.emailProvider || null,
    emailSubject: ACCESS_EMAIL_SUBJECT,
  });
});
