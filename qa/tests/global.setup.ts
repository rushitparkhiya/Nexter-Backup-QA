/**
 * global.setup.ts
 * Runs once before all tests:
 *  1. Clears any stale backup run state from previous test runs
 *  2. Logs in as admin and saves session state (.auth/admin.json)
 *  3. Creates the editor test user
 */
import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { BASE, ADMIN_USER, ADMIN_PASS, EDITOR_USER, EDITOR_PASS } from './_helpers';

export default async function globalSetup(_config: FullConfig) {
  // ── Clear stale backup state ───────────────────────────────────────────────
  // Previous test runs may leave a backup in "running" state if they timed out.
  // The plugin's stale detection requires 3× max_runtime_sec (≥270 s) to elapse
  // before it self-heals, which can cause a 409 at the start of the next run.
  // Force-clear the relevant WP options so tests always start clean.
  const wpContainer = process.env.WP_DOCKER_CONTAINER ?? 'qa-wordpress-1';
  // Helper that swallows non-zero exits (option may not exist — that's fine).
  const wpCli = (args: string) => {
    try {
      execSync(`docker exec ${wpContainer} wp --allow-root ${args}`, { stdio: 'pipe' });
    } catch { /* ignore — option/transient may not exist */ }
  };
  const dockerExec = (cmd: string) => {
    try {
      execSync(`docker exec ${wpContainer} ${cmd}`, { stdio: 'pipe' });
    } catch { /* ignore */ }
  };
  try {
    // Clear stale lock/run options so tests start with a clean slate.
    wpCli('option delete nxt_backup_enqueue_lock');
    wpCli('transient delete nxt_backup_run_lock');
    wpCli('option delete nxt_backup_current_run');
    // Clear the stored backup list so we don't have stale entries from previous runs.
    wpCli('option delete nxt_backup_list');
    // Remove accumulated backup files — they can grow to tens of GB across runs
    // and massively slow down the archive stage (plugin archives uploads/ including itself).
    dockerExec('rm -rf /var/www/html/wp-content/uploads/nexter-backups');
    dockerExec('mkdir -p /var/www/html/wp-content/uploads/nexter-backups');
    dockerExec('chmod 777 /var/www/html/wp-content/uploads/nexter-backups');
    // Exclude the nexter-backups directory from future backups so the uploads
    // component does not re-archive previous backup files (snowball effect).
    wpCli('option patch insert nxt_backup_settings exclude_globs \'["nexter-backups/"]\'');
    console.log('[setup] Cleared stale backup state and old backup files.');
  } catch (e) {
    // Non-fatal: Docker may not be available in all CI environments.
    console.warn('[setup] Could not clear stale backup state via Docker:', (e as Error).message?.slice(0, 120));
  }

  // ── Admin login ────────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const page    = await browser.newPage();

  await page.goto(`${BASE}/wp-login.php`);
  await page.fill('#user_login', ADMIN_USER);
  await page.fill('#user_pass',  ADMIN_PASS);
  await page.click('#wp-submit');
  await page.waitForURL('**/wp-admin/**');

  // Persist admin session
  const authDir = path.join(__dirname, '..', '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: path.join(authDir, 'admin.json') });

  await browser.close();
  console.log('[setup] Admin session saved.');

  // ── Editor session ─────────────────────────────────────────────────────────
  // Editor user must be created out-of-band via WP-CLI:
  //   wp user create editor_test editor_test@example.test --role=editor --user_pass=editorpass
  const browser2 = await chromium.launch();
  const ctx2     = await browser2.newContext();
  const page2    = await ctx2.newPage();

  await page2.goto(`${BASE}/wp-login.php`);
  await page2.fill('#user_login', EDITOR_USER);
  await page2.fill('#user_pass',  EDITOR_PASS);
  await page2.click('#wp-submit');
  await page2.waitForURL('**/wp-admin/**');
  await ctx2.storageState({ path: path.join(authDir, 'editor.json') });

  await browser2.close();
  console.log('[setup] Editor session saved.');
}
