/** Shared helpers for Supabase Auth redirect / recovery URL handling (GitHub Pages SPA). */

export const RECOVERY_FLAG = 'tl_password_recovery';

/** Canonical Pages redirect target (trailing slash + reset=1 intent marker). */
export function appRedirectUrl(loc = typeof location !== 'undefined' ? location : { origin: '', pathname: '/' }) {
  let path = String(loc.pathname || '/').replace(/\/index\.html$/i, '/');
  if (!path.endsWith('/')) path += '/';
  return `${loc.origin}${path}?reset=1`;
}

/** Parse recovery / session params from query + hash (implicit + PKCE + token_hash). */
export function parseAuthUrl(loc = typeof location !== 'undefined' ? location : { search: '', hash: '' }) {
  const q = new URLSearchParams(loc.search || '');
  const h = new URLSearchParams(String(loc.hash || '').replace(/^#/, ''));
  const type = q.get('type') || h.get('type') || '';
  const resetFlag = q.get('reset') === '1' || h.get('reset') === '1';
  const access_token = h.get('access_token') || q.get('access_token') || '';
  const refresh_token = h.get('refresh_token') || q.get('refresh_token') || '';
  const code = q.get('code') || '';
  const token_hash = q.get('token_hash') || h.get('token_hash') || '';
  const rawError = q.get('error_description') || q.get('error') || h.get('error_description') || h.get('error') || '';
  const error = rawError ? decodeURIComponent(rawError.replace(/\+/g, ' ')) : '';
  const looksRecovery = type === 'recovery' || resetFlag;
  const hasAuthPayload = !!(access_token || code || token_hash);
  return { type, resetFlag, access_token, refresh_token, code, token_hash, error, looksRecovery, hasAuthPayload };
}

export function scrubAuthParamsFromUrl(historyObj = typeof history !== 'undefined' ? history : null, loc = typeof location !== 'undefined' ? location : null) {
  if (!historyObj || !loc) return;
  if (!loc.hash && !loc.search) return;
  let path = String(loc.pathname || '/').replace(/\/index\.html$/i, '/');
  if (!path.endsWith('/')) path += '/';
  historyObj.replaceState({}, typeof document !== 'undefined' ? document.title : '', `${loc.origin}${path}`);
}

export function markRecoveryIntent(storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null) {
  try { storage?.setItem(RECOVERY_FLAG, '1'); } catch (_) {}
}

export function clearRecoveryIntent(storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null) {
  try { storage?.removeItem(RECOVERY_FLAG); } catch (_) {}
}

export function hasRecoveryIntent(storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null, loc) {
  const parsed = parseAuthUrl(loc);
  let flagged = false;
  try { flagged = storage?.getItem(RECOVERY_FLAG) === '1'; } catch (_) {}
  return !!(parsed.looksRecovery || flagged);
}
