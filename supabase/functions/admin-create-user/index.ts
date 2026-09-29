// Supabase Edge Function: admin-create-user
// Creates or resets an Auth user with a temporary password (service role).
// Secrets (Dashboard → Edge Functions → Secrets, never commit):
//   SUPABASE_SERVICE_ROLE_KEY  (required)
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform.
// Deploy: supabase functions deploy admin-create-user --project-ref skezxxnhsvdrwrdxabje

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  if (!email || !email.includes('@')) return json(400, { error: 'Valid email is required.' });

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

  return json(200, { ok: true, created, password, email });
});
