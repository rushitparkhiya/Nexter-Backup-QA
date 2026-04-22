// @ts-check
/**
 * Orbit — Admin Notice / Banner Bleed Detection
 *
 * Problem: Plugins show admin notices, banners, upsell bars, review requests,
 * and dashboard widgets on pages they don't own — cluttering WooCommerce settings,
 * Yoast SEO, Elementor, and even core WP pages. This is one of the top causes
 * of 1-star reviews ("this plugin spams notices everywhere").
 *
 * What this tests:
 *   Visits 12 core WP admin pages + popular plugin pages.
 *   On each, looks for:
 *     - .notice elements containing your plugin's branding/slug
 *     - Admin bar items added by your plugin
 *     - Dashboard widgets from your plugin
 *     - Sticky banners or fixed-position overlays with your plugin's CSS class
 *
 * Usage:
 *   PLUGIN_SLUG=my-plugin \
 *   PLUGIN_CSS_PREFIX=my-plugin \
 *   WP_TEST_URL=http://localhost:8881 \
 *   npx playwright test flows/notice-bleed.spec.js
 *
 * PLUGIN_CSS_PREFIX: the CSS class prefix your plugin uses (default: same as PLUGIN_SLUG)
 * Severity: HIGH — notices on other plugin pages violate WP.org guidelines.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE       = process.env.WP_TEST_URL || 'http://localhost:8881';
const ADMIN      = `${BASE}/wp-admin`;
const SLUG       = process.env.PLUGIN_SLUG || '';
const CSS_PREFIX = process.env.PLUGIN_CSS_PREFIX || SLUG;
const REPORT_DIR = 'reports/pm-ux';

const FOREIGN_PAGES = [
  { name: 'Dashboard',           url: `${ADMIN}/` },
  { name: 'Posts List',          url: `${ADMIN}/edit.php` },
  { name: 'Pages List',          url: `${ADMIN}/edit.php?post_type=page` },
  { name: 'Media Library',       url: `${ADMIN}/upload.php` },
  { name: 'General Settings',    url: `${ADMIN}/options-general.php` },
  { name: 'Permalink Settings',  url: `${ADMIN}/options-permalink.php` },
  { name: 'Plugins List',        url: `${ADMIN}/plugins.php` },
  { name: 'Users',               url: `${ADMIN}/users.php` },
  { name: 'Themes',              url: `${ADMIN}/themes.php` },
  { name: 'WooCommerce',         url: `${ADMIN}/admin.php?page=wc-admin` },
  { name: 'Yoast SEO',           url: `${ADMIN}/admin.php?page=wpseo_dashboard` },
  { name: 'RankMath',            url: `${ADMIN}/admin.php?page=rank-math` },
  { name: 'Elementor',           url: `${ADMIN}/admin.php?page=elementor` },
  { name: 'WPForms',             url: `${ADMIN}/admin.php?page=wpforms-overview` },
];

test.describe('Admin notice bleed detection', () => {
  test.skip(!SLUG, 'Set PLUGIN_SLUG env var to run notice bleed detection');

  test('plugin notices and banners must not appear on foreign admin pages', async ({ page }) => {
    const bleeds = [];
    // Escape for use in regex
    const slugEscaped = CSS_PREFIX.replace(/[-]/g, '[-_]?');

    for (const { name, url } of FOREIGN_PAGES) {
      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 12000,
        });

        if (!response || response.status() >= 400) continue;

        const findings = await page.evaluate(({ slugEscaped, slug }) => {
          const found = [];
          const re = new RegExp(slugEscaped, 'i');

          // 1. Admin notices containing plugin branding
          document.querySelectorAll('.notice, .updated, .error, .warning').forEach(el => {
            if (re.test(el.className) || re.test(el.innerHTML)) {
              found.push({
                type: 'admin-notice',
                selector: el.className,
                text: el.innerText?.trim().slice(0, 120),
              });
            }
          });

          // 2. Admin bar items from plugin
          document.querySelectorAll('#wpadminbar .ab-item, #wpadminbar li').forEach(el => {
            if (re.test(el.id || '') || re.test(el.className)) {
              found.push({
                type: 'admin-bar-item',
                selector: el.id || el.className,
                text: el.innerText?.trim().slice(0, 80),
              });
            }
          });

          // 3. Dashboard widgets from plugin
          document.querySelectorAll('.postbox, .dashboard-widget').forEach(el => {
            if (re.test(el.id || '') || re.test(el.className)) {
              found.push({
                type: 'dashboard-widget',
                selector: el.id || el.className,
                text: el.querySelector('h2, h3')?.innerText?.trim() || '',
              });
            }
          });

          // 4. Fixed/sticky banners (position:fixed or position:sticky with plugin class)
          document.querySelectorAll('[style*="position:fixed"],[style*="position: fixed"],[style*="position:sticky"]').forEach(el => {
            if (re.test(el.className) || re.test(el.id || '')) {
              found.push({
                type: 'sticky-banner',
                selector: el.className || el.id,
                text: el.innerText?.trim().slice(0, 80),
              });
            }
          });

          // 5. Any element whose class matches the slug pattern
          document.querySelectorAll(`[class*="${slug}"]`).forEach(el => {
            // Exclude the plugin's own admin page
            if (!window.location.href.includes(slug)) {
              if (!found.some(f => f.selector === el.className)) {
                found.push({
                  type: 'plugin-element',
                  selector: el.className?.slice(0, 60),
                  text: el.innerText?.trim().slice(0, 80),
                });
              }
            }
          });

          return found;
        }, { slugEscaped, slug: SLUG });

        if (findings.length > 0) {
          bleeds.push({ page: name, url, findings });
          console.log(`\n✗ [Notice Bleed] "${name}" — ${findings.length} plugin element(s) bleeding in:`);
          findings.forEach(f => {
            console.log(`    [${f.type}] ${f.selector}`);
            if (f.text) console.log(`    Text: "${f.text}"`);
          });
          console.log(`    Fix: use add_action('admin_notices', ...) only on your plugin's screens`);
          console.log(`    Use: get_current_screen()->id === 'your-plugin-page-slug'`);
        }
      } catch {
        // Page unreachable — skip
      }
    }

    // Report
    const report = {
      slug: SLUG,
      cssPrefix: CSS_PREFIX,
      pagesChecked: FOREIGN_PAGES.length,
      bleedingPages: bleeds.length,
      bleeds,
      wpGuideline: 'https://developer.wordpress.org/plugins/settings/notices/',
      fix: 'Wrap admin_notices callback with: if ( get_current_screen()->id !== "your-plugin-page" ) return;',
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, 'notice-bleed.json'),
      JSON.stringify(report, null, 2)
    );

    const high = bleeds.filter(b => b.findings.some(f => f.type === 'admin-notice' || f.type === 'sticky-banner'));

    if (bleeds.length === 0) {
      console.log(`\n✓ No notice bleed — plugin elements confined to own pages`);
    } else {
      console.log(`\n[Notice Bleed] ${bleeds.length} page(s) affected (${high.length} high severity)`);
    }

    // High severity bleed (admin notice on a foreign page) triggers a test failure
    expect(high.length, `Plugin admin notices appearing on ${high.length} foreign page(s). Check reports/pm-ux/notice-bleed.json`).toBe(0);
  });
});
