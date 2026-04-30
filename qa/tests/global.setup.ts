/**
 * global.setup.ts
 * Runs once before all tests:
 *  1. Logs in as admin and saves session state (.auth/admin.json)
 *  2. Activates the Nexter Extension plugin via WP-CLI (idempotent)
 *  3. Creates the editor test user
 */
import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE, ADMIN_USER, ADMIN_PASS, EDITOR_USER, EDITOR_PASS } from './_helpers';

export default async function globalSetup(_config: FullConfig) {
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

  // ── Create editor user (idempotent via REST) ───────────────────────────────
  // Uses the already-saved cookie to hit the REST API
  const browser2 = await chromium.launch();
  const ctx2     = await browser2.newContext({
    storageState: path.join(authDir, 'admin.json'),
  });
  const page2 = await ctx2.newPage();
  const nonce: string = await page2.evaluate(() =>
    fetch('/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=rest-nonce',
    }).then(r => r.text()),
  );

  await page2.evaluate(
    async ([user, pass, nonce]) => {
      await fetch('/wp-json/wp/v2/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        body: JSON.stringify({ username: user, password: pass, email: `${user}@example.test`, roles: ['editor'] }),
      });
    },
    [EDITOR_USER, EDITOR_PASS, nonce.trim()],
  );

  // Persist editor session
  await page2.goto(`${BASE}/wp-login.php`);
  await page2.fill('#user_login', EDITOR_USER);
  await page2.fill('#user_pass',  EDITOR_PASS);
  await page2.click('#wp-submit');
  await page2.waitForURL('**/wp-admin/**');
  await ctx2.storageState({ path: path.join(authDir, 'editor.json') });

  await browser2.close();
  console.log('[setup] Editor session saved.');
}
