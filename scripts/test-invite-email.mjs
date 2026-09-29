import {
  ACCESS_EMAIL_SUBJECT,
  DEFAULT_APP_URL,
  accessEmailBody,
  accessEmailCopyText,
  accessMailtoHref
} from '../src/invite-email.mjs';

let failed = 0;
const assert = (name, cond) => {
  if (!cond) { failed += 1; console.error('FAIL', name); }
  else console.log('ok', name);
};

assert('subject matches branded template', ACCESS_EMAIL_SUBJECT === 'Team Leave — Your temporary password');

const body = accessEmailBody('teammate@example.com', 'TEMP-PLACEHOLDER-ONLY', 'https://omenada2025.github.io/Team-Leave/');
assert('body names Team Leave', /Team Leave/.test(body));
assert('body includes app URL in intro', body.includes(DEFAULT_APP_URL));
assert('body includes email', body.includes('teammate@example.com'));
assert('body includes temp password placeholder step', body.includes('Temporary password: TEMP-PLACEHOLDER-ONLY'));
assert('body tells them to choose a new password', /choose a new password/i.test(body));
assert('body has trust footer', /Daniela’s team \(Zenatech\)/.test(body));
assert('body warns not to forward', /Do not forward this email/.test(body));
assert('body does not look like generic subject', !/Your Team Leave access/.test(body));

const copy = accessEmailCopyText('teammate@example.com', 'TEMP-PLACEHOLDER-ONLY');
assert('copy includes subject line', copy.startsWith(`Subject: ${ACCESS_EMAIL_SUBJECT}\n\n`));

const href = accessMailtoHref('teammate@example.com', 'TEMP-PLACEHOLDER-ONLY');
assert('mailto uses branded subject', href.includes(`subject=${encodeURIComponent(ACCESS_EMAIL_SUBJECT)}`));
assert('mailto encodes body', href.includes('body=') && href.includes(encodeURIComponent('Temporary password: TEMP-PLACEHOLDER-ONLY')));
assert('mailto targets recipient', href.startsWith('mailto:teammate%40example.com'));

if (failed) {
  console.error(`${failed} invite-email assertion(s) failed`);
  process.exit(1);
}
console.log('invite-email tests passed');
