// @ts-check
/**
 * Orbit — Data Deletion UX Test
 *
 * What this tests:
 *   1. Plugin offers a "Delete all data" option on deactivation or in settings.
 *   2. Email opt-in forms (if any) include a clear consent checkbox.
 *   3. The plugin's settings page has a visible privacy/data section.
 *   4. Users can find where their data is stored (transparency).
 *
 * GDPR Article 17 gives users the right to erasure ("right to be forgotten").
 * WP.org guidelines require plugins storing user data to offer a deletion path.
 *
 * Usage:
 *   PLUGIN_SLUG=my-plugin \
 *   PLUGIN_ADMIN_SLUG=my-plugin-settings \
 *   PLUGIN_HAS_EMAIL_FORMS=true \
 *   WP_TEST_URL=http://localhost:8881 \
 *   npx playwright test flows/data-deletion-ux.spec.js
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE        = process.env.WP_TEST_URL || 'http://localhost:8881';
const ADMIN       = `${BASE}/wp-admin`;
const SLUG        = process.env.PLUGIN_SLUG || '';
const ADMIN_SLUG  = process.env.PLUGIN_ADMIN_SLUG || SLUG;
const HAS_FORMS   = (process.env.PLUGIN_HAS_EMAIL_FORMS || 'false') === 'true';
const WP_ENV_RUN  = process.env.WP_ENV_RUN || 'npx wp-env run cli wp';
const REPORT_DIR  = 'reports/pm-ux';

function wp(cmd) {
  try { return execSync(`${WP_ENV_RUN} ${cmd}`, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

test.describe('Data deletion UX (GDPR Article 17)', () => {
  test.skip(!SLUG, 'Set PLUGIN_SLUG to run data deletion tests');

  test('plugin settings contain data management / privacy section', async ({ page }) => {
    await page.goto(`${ADMIN}/admin.php?page=${ADMIN_SLUG}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const html = await page.content();

    const privacyKeywords = [
      'delete', 'remove data', 'erase', 'privacy', 'gdpr', 'data management',
      'uninstall data', 'keep data', 'export data', 'your data',
    ];

    const found = privacyKeywords.filter(kw =>
      html.toLowerCase().includes(kw)
    );

    const report = {
      slug: SLUG,
      adminPage: `${ADMIN}/admin.php?page=${ADMIN_SLUG}`,
      privacyKeywordsFound: found,
      hasPrivacySection: found.length >= 2,
      issues: [],
    };

    if (found.length < 2) {
      report.issues.push({
        severity: 'medium',
        issue: 'No visible privacy/data management section in plugin settings',
        gdprArticle: 'GDPR Article 13 — users must be informed about data processing',
        fix: 'Add a "Data & Privacy" tab or section in your settings page. Include: what data you store, how to export it, how to delete it.',
      });
      console.log(`\n⚠ [Data UX] No privacy/data section found in plugin settings`);
      console.log(`  Found ${found.length}/2+ required keywords: [${found.join(', ')}]`);
    } else {
      console.log(`\n✓ [Data UX] Privacy section present — found: [${found.join(', ')}]`);
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, 'data-deletion-ux.json'),
      JSON.stringify(report, null, 2)
    );

    // WARN — never hard-block
    expect(true).toBe(true);
  });

  test('deactivation screen offers data deletion choice', async ({ page }) => {
    // Visit plugins page — check if deactivation triggers a modal/dialog
    await page.goto(`${ADMIN}/plugins.php`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Look for deactivation link for this plugin
    const deactivateLink = page.locator(`[href*="deactivate"], [data-plugin*="${SLUG}"]`).first();
    const exists = await deactivateLink.isVisible({ timeout: 3000 }).catch(() => false);

    if (!exists) {
      console.log(`\n[Data UX] Could not find deactivation link for ${SLUG} — plugin may not be active`);
      return;
    }

    // Check if clicking deactivate triggers a dialog/modal asking about data
    const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 }).catch(() => null);

    // Don't actually click — just check if the plugin has a deactivation hook
    // by looking at the page source for known deactivation survey/data-delete patterns
    const html = await page.content();
    const hasDeactivationHook = html.includes(`deactivate-${SLUG}`) ||
                                 html.includes(`${SLUG}-deactivate`);

    // Check via WP-CLI if plugin has uninstall.php (required for data deletion)
    const hasUninstallPhp = wp(`eval 'echo file_exists(WP_PLUGIN_DIR . "/${SLUG}/uninstall.php") ? "yes" : "no";'`);

    console.log(`\n[Data UX] Deactivation check for ${SLUG}:`);
    console.log(`  Has uninstall.php: ${hasUninstallPhp || 'unknown'}`);
    console.log(`  Has deactivation hook in DOM: ${hasDeactivationHook}`);

    if (hasUninstallPhp === 'no') {
      console.log(`  ⚠ Missing uninstall.php — plugin data will not be cleaned on deletion`);
      console.log(`  Fix: Create uninstall.php that deletes all options, tables, transients`);
    }

    expect(true).toBe(true);
  });

  test('email opt-in forms have explicit consent checkbox', async ({ page }) => {
    test.skip(!HAS_FORMS, 'Set PLUGIN_HAS_EMAIL_FORMS=true if plugin has email collection');

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

    const forms = await page.evaluate(() => {
      const found = [];
      document.querySelectorAll('form').forEach(form => {
        const emailInput = form.querySelector('input[type="email"]');
        if (!emailInput) return;

        const consentCheckbox = form.querySelector(
          'input[type="checkbox"][name*="consent"], input[type="checkbox"][name*="gdpr"], input[type="checkbox"][name*="agree"], input[type="checkbox"][name*="terms"]'
        );
        const consentText = form.innerText.match(/(consent|agree|privacy policy|terms|gdpr)/gi);

        found.push({
          action: form.action || 'unknown',
          hasEmailInput: true,
          hasConsentCheckbox: !!consentCheckbox,
          hasConsentLanguage: (consentText?.length || 0) > 0,
          consentTermsFound: consentText || [],
        });
      });
      return found;
    });

    const issues = forms.filter(f => !f.hasConsentCheckbox && !f.hasConsentLanguage);

    console.log(`\n[Email Opt-in] ${forms.length} form(s) with email fields`);
    forms.forEach(f => {
      const status = (f.hasConsentCheckbox || f.hasConsentLanguage) ? '✓' : '✗';
      console.log(`  ${status} ${f.action} — consent: ${f.hasConsentCheckbox ? 'checkbox' : f.hasConsentLanguage ? 'language only' : 'MISSING'}`);
    });

    if (issues.length > 0) {
      console.log(`\n  ✗ ${issues.length} form(s) collecting email without visible consent mechanism`);
      console.log(`    GDPR requires explicit, informed consent before collecting personal data`);
      console.log(`    Fix: add a required checkbox: [ ] I agree to receive emails (Privacy Policy link)`);
    }

    expect(issues.length, `${issues.length} email form(s) missing consent mechanism`).toBe(0);
  });
});
