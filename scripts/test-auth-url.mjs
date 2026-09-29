import {
  appRedirectUrl, parseAuthUrl, hasRecoveryIntent, markRecoveryIntent, clearRecoveryIntent, RECOVERY_FLAG
} from '../src/auth-url.mjs';

let failed = 0;
const assert = (name, cond) => {
  if (!cond) { failed += 1; console.error('FAIL', name); }
  else console.log('ok', name);
};

const pages = {
  origin: 'https://omenada2025.github.io',
  pathname: '/Team-Leave/',
  search: '',
  hash: ''
};
assert('redirect includes trailing slash and reset flag', appRedirectUrl(pages) === 'https://omenada2025.github.io/Team-Leave/?reset=1');
assert('redirect normalizes index.html', appRedirectUrl({...pages, pathname: '/Team-Leave/index.html'}) === 'https://omenada2025.github.io/Team-Leave/?reset=1');
assert('redirect adds slash when missing', appRedirectUrl({...pages, pathname: '/Team-Leave'}) === 'https://omenada2025.github.io/Team-Leave/?reset=1');

const hashRecovery = parseAuthUrl({
  search: '?reset=1',
  hash: '#access_token=aaa&refresh_token=bbb&type=recovery&token_type=bearer'
});
assert('hash recovery type', hashRecovery.type === 'recovery');
assert('hash recovery looksRecovery', hashRecovery.looksRecovery);
assert('hash recovery tokens', hashRecovery.access_token === 'aaa' && hashRecovery.refresh_token === 'bbb');
assert('hash recovery hasAuthPayload', hashRecovery.hasAuthPayload);

const codeOnly = parseAuthUrl({ search: '?code=abc123', hash: '' });
assert('pkce code detected', codeOnly.code === 'abc123' && codeOnly.hasAuthPayload);
assert('code alone is not recovery unless flagged', !codeOnly.looksRecovery);

const tokenHash = parseAuthUrl({ search: '?token_hash=xyz&type=recovery', hash: '' });
assert('token_hash recovery', tokenHash.token_hash === 'xyz' && tokenHash.looksRecovery);

const storage = new Map();
const mem = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k)
};
markRecoveryIntent(mem);
assert('session flag set', mem.getItem(RECOVERY_FLAG) === '1');
assert('intent from flag', hasRecoveryIntent(mem, { search: '', hash: '' }));
clearRecoveryIntent(mem);
assert('intent from reset query', hasRecoveryIntent(mem, { search: '?reset=1', hash: '' }));
assert('cleared flag', mem.getItem(RECOVERY_FLAG) == null);

if (failed) { console.error(`\n${failed} auth-url check(s) failed`); process.exit(1); }
console.log('\nAll auth-url checks passed.');
