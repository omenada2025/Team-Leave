/** Branded temp-password mailto helpers (docs/email-templates/welcome-temp-password.*). */

export const ACCESS_EMAIL_SUBJECT = 'Team Leave — Your temporary password';

export const DEFAULT_APP_URL = 'https://omenada2025.github.io/Team-Leave/';

/** Plain-text body for mailto / Copy email. Placeholders filled at send time. */
export function accessEmailBody(email, password, appUrl = DEFAULT_APP_URL) {
  return (
    `An admin added you to Team Leave\n` +
    `(${DEFAULT_APP_URL}).\n\n` +
    `1. Open: ${appUrl}\n` +
    `2. Sign in with:\n` +
    `   Email: ${email}\n` +
    `   Temporary password: ${password}\n` +
    `3. You will be asked to choose a new password before using the app.\n\n` +
    `Do not forward this email. If you did not expect access, tell your admin.\n\n` +
    `— Team Leave · Daniela’s team (Zenatech)`
  );
}

export function accessEmailCopyText(email, password, appUrl = DEFAULT_APP_URL) {
  return `Subject: ${ACCESS_EMAIL_SUBJECT}\n\n${accessEmailBody(email, password, appUrl)}`;
}

export function accessMailtoHref(email, password, appUrl = DEFAULT_APP_URL) {
  return (
    `mailto:${encodeURIComponent(email)}` +
    `?subject=${encodeURIComponent(ACCESS_EMAIL_SUBJECT)}` +
    `&body=${encodeURIComponent(accessEmailBody(email, password, appUrl))}`
  );
}
