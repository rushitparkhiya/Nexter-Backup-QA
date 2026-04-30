/**
 * NexterBackup QA — shared helpers
 *
 * All REST calls go through apiFetch() which attaches the WP nonce
 * and the base URL automatically. The nonce is obtained once per
 * test file via getNonce() after the admin session is loaded.
 *
 * BUG-5 FIX: All helpers now accept Page instead of APIRequestContext so
 * that page.request.* is used, which inherits the admin session cookies
 * from the storage state. The bare `request` fixture is a fresh context
 * with no cookies → WP REST returns 403 for every protected route.
 */
import { Page, expect } from '@playwright/test';

export const BASE = process.env.WP_URL ?? 'http://localhost:8889';
export const NS   = `${BASE}/wp-json/nxt-backup/v1`;

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Returns the WP REST nonce for the currently logged-in admin session.
 *  Reads from window.wpApiSettings.nonce which WP injects into every admin page.
 *  If the page hasn't navigated yet, navigates to the admin home first.
 */
export async function getNonce(page: Page): Promise<string> {
  // Primary: read the nonce WP already embedded via wp_localize_script('wp-api', ...)
  const nonce = await page.evaluate((): string =>
    (window as unknown as { wpApiSettings?: { nonce?: string } }).wpApiSettings?.nonce ?? '',
  );
  if (nonce) return nonce;

  // Page not on a WP admin page yet — navigate there first
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  return page.evaluate((): string =>
    (window as unknown as { wpApiSettings?: { nonce?: string } }).wpApiSettings?.nonce ?? '',
  );
}

/** Builds an Authorization-free fetch with nonce + JSON content-type. */
export function buildHeaders(nonce: string): Record<string, string> {
  return {
    'X-WP-Nonce': nonce,
    'Content-Type': 'application/json',
  };
}

// ── REST wrappers ─────────────────────────────────────────────────────────────

export async function apiGet(
  page: Page,
  nonce: string,
  path: string,
  params?: Record<string, string>,
) {
  const url = new URL(`${NS}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await page.request.get(url.toString(), {
    headers: { 'X-WP-Nonce': nonce },
  });
  return res;
}

export async function apiPost(
  page: Page,
  nonce: string,
  path: string,
  body?: unknown,
) {
  return page.request.post(`${NS}${path}`, {
    headers: buildHeaders(nonce),
    data: body ?? {},
  });
}

export async function apiPut(
  page: Page,
  nonce: string,
  path: string,
  body?: unknown,
) {
  return page.request.put(`${NS}${path}`, {
    headers: buildHeaders(nonce),
    data: body ?? {},
  });
}

export async function apiDelete(
  page: Page,
  nonce: string,
  path: string,
  body?: unknown,
) {
  return page.request.delete(`${NS}${path}`, {
    headers: buildHeaders(nonce),
    data: body ?? {},
  });
}

// ── Backup polling ────────────────────────────────────────────────────────────

export const TERMINAL = new Set(['success', 'failed', 'cancelled']);

/**
 * Polls /backup/run/current until a terminal status.
 * Drives /backup/run/step if cron is disabled (NXT_BACKUP_TESTING=true mode).
 * Returns the final run record.
 */
export async function waitForBackup(
  page: Page,
  nonce: string,
  opts: { driveSteps?: boolean; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (opts.driveSteps) {
      await apiPost(page, nonce, '/backup/run/step');
    }
    const res  = await apiGet(page, nonce, '/backup/run/current');
    const body = await res.json() as { data?: Record<string, unknown> };
    const run  = body.data ?? {};
    if (TERMINAL.has(run.status as string)) return run;
    await sleep(2_000);
  }
  throw new Error('waitForBackup: timed out');
}

/**
 * Polls /backup/restore/run/current until terminal.
 */
export async function waitForRestore(
  page: Page,
  nonce: string,
  opts: { driveSteps?: boolean; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (opts.driveSteps) {
      await apiPost(page, nonce, '/backup/restore/run/step');
    }
    const res  = await apiGet(page, nonce, '/backup/restore/run/current');
    const body = await res.json() as { data?: Record<string, unknown> };
    const run  = body.data ?? {};
    if (TERMINAL.has(run.status as string)) return run;
    await sleep(2_000);
  }
  throw new Error('waitForRestore: timed out');
}

// ── Backup list helpers ───────────────────────────────────────────────────────

/** Returns the latest backup entry from /backup/list, or null. */
export async function latestBackup(
  page: Page,
  nonce: string,
): Promise<Record<string, unknown> | null> {
  const res  = await apiGet(page, nonce, '/backup/list');
  const body = await res.json() as { data?: Record<string, unknown>[] };
  return body.data?.[0] ?? null;
}

/** Triggers a full backup and waits for completion. Returns the backup record.
 *  If a backup or restore is already in-progress (409), drives it to completion
 *  first, then starts a fresh backup.
 */
export async function runFullBackup(
  page: Page,
  nonce: string,
  extraBody: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let runRes = await apiPost(page, nonce, '/backup/run', { type: 'full', ...extraBody });

  if (runRes.status() === 409) {
    // A backup OR restore may be running. Check which one is active and drive
    // it to completion before starting ours.
    try {
      const restoreRes  = await apiGet(page, nonce, '/backup/restore/run/current');
      const restoreBody = await restoreRes.json() as { data?: Record<string, unknown> };
      const restoreStatus = restoreBody.data?.status as string | undefined;
      if (restoreStatus && !TERMINAL.has(restoreStatus)) {
        // A restore is in-flight — drive it to completion first.
        await waitForRestore(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
      } else {
        // Must be a backup in-flight.
        await waitForBackup(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
      }
    } catch {
      // Fallback: just wait for backup (original behaviour).
      await waitForBackup(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
    }
    runRes = await apiPost(page, nonce, '/backup/run', { type: 'full', ...extraBody });
  }

  expect(runRes.status()).toBe(200);
  // Use 240 s for the fresh backup — the default 90 s is tight for slow envs.
  const run = await waitForBackup(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
  expect(run.status).toBe('success');
  const backup = await latestBackup(page, nonce);
  expect(backup).not.toBeNull();
  return backup!;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export const ADMIN_USER = process.env.WP_ADMIN_USER ?? 'admin';
export const ADMIN_PASS = process.env.WP_ADMIN_PASS ?? 'password';
export const EDITOR_USER = process.env.WP_EDITOR_USER ?? 'editor_test';
export const EDITOR_PASS = process.env.WP_EDITOR_PASS ?? 'editorpass';

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
