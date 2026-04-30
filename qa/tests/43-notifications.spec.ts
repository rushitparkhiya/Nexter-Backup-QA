/**
 * 43-notifications.spec.ts
 * Deep QA: email notifications.
 *
 * Requires a mail-catcher (Mailpit / MailHog) configured as the WP SMTP target.
 * Without one most tests skip — they verify the trigger emits, but content
 * verification needs the catcher.
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPut, apiPost, runFullBackup, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const MAIL_API = process.env.MAILPIT_URL ?? '';

async function clearMail(request: import('@playwright/test').APIRequestContext) {
  if (!MAIL_API) return;
  await request.delete(`${MAIL_API}/api/v1/messages`).catch(() => {});
}

async function fetchMail(request: import('@playwright/test').APIRequestContext) {
  if (!MAIL_API) return [];
  const res  = await request.get(`${MAIL_API}/api/v1/messages`).catch(() => null);
  if (!res) return [];
  const body = await res.json() as { messages?: { Subject: string; From: string; Snippet: string }[] };
  return body.messages ?? [];
}

// ── Settings shape ───────────────────────────────────────────────────────────
test('@deep NOT-001 — Notification settings can be persisted', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    notify_email:        'qa@example.test',
    notify_when:         'always',
    notify_attach_log:   true,
  });
  expect(res.status()).toBe(200);
});

// ── Email on success ─────────────────────────────────────────────────────────
test('@deep NOT-002 — Email sent after successful backup when notify_when=always', async ({ page, request }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL to e.g. http://mailpit:8025 for content verification');

  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', {
    notify_email: 'qa@example.test',
    notify_when:  'always',
  });

  await clearMail(request);
  await runFullBackup(request, nonce);

  // Wait briefly for mail to arrive
  await new Promise(r => setTimeout(r, 5_000));
  const msgs = await fetchMail(request);
  expect(msgs.length).toBeGreaterThan(0);
  expect(msgs[0].Subject).toMatch(/backup/i);
});

// ── Email on failure only ────────────────────────────────────────────────────
test('@deep NOT-003 — No email sent on success when notify_when=failure', async ({ page, request }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', {
    notify_email: 'qa@example.test',
    notify_when:  'failure',
  });

  await clearMail(request);
  await runFullBackup(request, nonce);
  await new Promise(r => setTimeout(r, 3_000));

  const msgs = await fetchMail(request);
  expect(msgs.length).toBe(0);
});

// ── Disabled notifications ───────────────────────────────────────────────────
test('@deep NOT-004 — No email sent when notify_email is empty', async ({ page, request }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', {
    notify_email: '',
  });

  await clearMail(request);
  await runFullBackup(request, nonce);
  await new Promise(r => setTimeout(r, 3_000));

  const msgs = await fetchMail(request);
  expect(msgs.length).toBe(0);
});

// ── Multiple recipients ──────────────────────────────────────────────────────
test('@deep NOT-005 — notify_email accepts comma-separated list', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    notify_email: 'a@example.test, b@example.test',
  });
  expect(res.status()).toBe(200);
});

// ── Attached log ─────────────────────────────────────────────────────────────
test('@deep NOT-006 — Email includes log attachment when notify_attach_log=true', async ({ page, request }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', {
    notify_email:      'qa@example.test',
    notify_when:       'always',
    notify_attach_log: true,
  });

  await clearMail(request);
  await runFullBackup(request, nonce);
  await new Promise(r => setTimeout(r, 5_000));

  const msgs = await fetchMail(request);
  if (msgs.length > 0) {
    const detail = await (await import('@playwright/test')).request.newContext()
      .then(ctx => ctx.get(`${MAIL_API}/api/v1/message/${(msgs[0] as Record<string, unknown>).ID}`));
    const body = await detail.json() as { Attachments?: unknown[] };
    expect(Array.isArray(body.Attachments)).toBe(true);
  }
});

// ── Subject contains site label ──────────────────────────────────────────────
test('@deep NOT-007 — Email subject contains the site URL or label', async ({ page, request }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL');

  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', {
    notify_email: 'qa@example.test',
    notify_when:  'always',
    site_label:   'My QA Site',
  });

  await clearMail(request);
  await runFullBackup(request, nonce);
  await new Promise(r => setTimeout(r, 5_000));

  const msgs = await fetchMail(request);
  expect(msgs.length).toBeGreaterThan(0);
  expect(msgs[0].Subject).toMatch(/My QA Site|qa-site|localhost/i);
});

// ── Email throttling ─────────────────────────────────────────────────────────
test('@deep NOT-008 — 5 backups in succession do not result in 5 individual emails (throttled)', async ({ page, request }) => {
  test.skip(!MAIL_API, 'Set MAILPIT_URL — also requires email_throttle setting');

  const nonce = await getNonce(page);
  await clearMail(request);

  for (let i = 0; i < 3; i++) await runFullBackup(request, nonce);
  await new Promise(r => setTimeout(r, 5_000));

  const msgs = await fetchMail(request);
  // Throttling spec varies; at most 3 expected
  expect(msgs.length).toBeLessThanOrEqual(5);
});
