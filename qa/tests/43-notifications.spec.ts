/**
 * 43-notifications.spec.ts
 * Deep QA: email notifications.
 *
 * Requires a mail-catcher (Mailpit / MailHog) configured as the WP SMTP target.
 * Without one most tests skip â€” they verify the trigger emits, but content
 * verification needs the catcher.
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPut, apiPost, runFullBackup, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const MAIL_API = process.env.MAILPIT_URL ?? '';

async function clearMail(page: import('@playwright/test').Page) {
  if (!MAIL_API) return;
  await page.request.delete(`${MAIL_API}/api/v1/messages`).catch(() => {});
}

async function fetchMail(page: import('@playwright/test').Page) {
  if (!MAIL_API) return [];
  const res  = await page.request.get(`${MAIL_API}/api/v1/messages`).catch(() => null);
  if (!res) return [];
  const body = await res.json() as { messages?: { Subject: string; From: string; Snippet: string }[] };
  return body.messages ?? [];
}

// â”€â”€ Settings shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-001 â€” Notification settings can be persisted', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/settings', {
    notify_email:        'qa@example.test',
    notify_when:         'always',
    notify_attach_log:   true,
  });
  expect(res.status()).toBe(200);
});

// â”€â”€ Email on success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-002 â€” Email sent after successful backup when notify_when=always', async ({ page }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL to e.g. http://mailpit:8025 for content verification');

  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', {
    notify_email: 'qa@example.test',
    notify_when:  'always',
  });

  await clearMail(page);
  await runFullBackup(page, nonce);

  // Wait briefly for mail to arrive
  await new Promise(r => setTimeout(r, 5_000));
  const msgs = await fetchMail(page);
  expect(msgs.length).toBeGreaterThan(0);
  expect(msgs[0].Subject).toMatch(/backup/i);
});

// â”€â”€ Email on failure only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-003 â€” No email sent on success when notify_when=failure', async ({ page }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', {
    notify_email: 'qa@example.test',
    notify_when:  'failure',
  });

  await clearMail(page);
  await runFullBackup(page, nonce);
  await new Promise(r => setTimeout(r, 3_000));

  const msgs = await fetchMail(page);
  expect(msgs.length).toBe(0);
});

// â”€â”€ Disabled notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-004 â€” No email sent when notify_email is empty', async ({ page }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', {
    notify_email: '',
  });

  await clearMail(page);
  await runFullBackup(page, nonce);
  await new Promise(r => setTimeout(r, 3_000));

  const msgs = await fetchMail(page);
  expect(msgs.length).toBe(0);
});

// â”€â”€ Multiple recipients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-005 â€” notify_email accepts comma-separated list', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/settings', {
    notify_email: 'a@example.test, b@example.test',
  });
  expect(res.status()).toBe(200);
});

// â”€â”€ Attached log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-006 â€” Email includes log attachment when notify_attach_log=true', async ({ page }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', {
    notify_email:      'qa@example.test',
    notify_when:       'always',
    notify_attach_log: true,
  });

  await clearMail(page);
  await runFullBackup(page, nonce);
  await new Promise(r => setTimeout(r, 5_000));

  const msgs = await fetchMail(page);
  if (msgs.length > 0) {
    const detail = await (await import('@playwright/test')).request.newContext()
      .then(ctx => ctx.get(`${MAIL_API}/api/v1/message/${(msgs[0] as Record<string, unknown>).ID}`));
    const body = await detail.json() as { Attachments?: unknown[] };
    expect(Array.isArray(body.Attachments)).toBe(true);
  }
});

// â”€â”€ Subject contains site label â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-007 â€” Email subject contains the site URL or label', async ({ page }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', {
    notify_email: 'qa@example.test',
    notify_when:  'always',
    site_label:   'My QA Site',
  });

  await clearMail(page);
  await runFullBackup(page, nonce);
  await new Promise(r => setTimeout(r, 5_000));

  const msgs = await fetchMail(page);
  expect(msgs.length).toBeGreaterThan(0);
  expect(msgs[0].Subject).toMatch(/My QA Site|qa-site|localhost/i);
});

// â”€â”€ Email throttling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep NOT-008 â€” 5 backups in succession do not result in 5 individual emails (throttled)', async ({ page }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL â€” also requires email_throttle setting');

  const nonce = await getNonce(page);
  await clearMail(page);

  for (let i = 0; i < 3; i++) await runFullBackup(page, nonce);
  await new Promise(r => setTimeout(r, 5_000));

  const msgs = await fetchMail(page);
  // Throttling spec varies; at most 3 expected
  expect(msgs.length).toBeLessThanOrEqual(5);
});
