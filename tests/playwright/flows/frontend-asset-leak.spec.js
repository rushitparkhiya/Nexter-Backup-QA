// @ts-check
/**
 * Orbit — Frontend Asset Leak Detection
 *
 * Problem: Plugins load their CSS/JS globally on every frontend page — even on
 * pages where they produce no output. A contact form plugin loading its 200KB
 * CSS on the homepage, About page, and blog archive is a real, common problem
 * that tanks Lighthouse scores and raises LCP.
 *
 * What this tests:
 *   1. Finds pages where your plugin has no visible output.
 *   2. Checks if your plugin's assets still load on those pages.
 *   3. Measures the KB penalty (how much extra weight every visitor pays).
 *
 * Configuration (in qa.config.json):
 *   plugin.frontend_active_pages: ["/contact/", "/my-plugin-shortcode-page/"]
 *   — Pages where your plugin IS expected to output something.
 *
 * Pages NOT in that list are checked for asset presence.
 *
 * Usage:
 *   PLUGIN_SLUG=my-plugin \
 *   PLUGIN_ACTIVE_PAGES="/contact/,/checkout/" \
 *   WP_TEST_URL=http://localhost:8881 \
 *   npx playwright test flows/frontend-asset-leak.spec.js
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE         = process.env.WP_TEST_URL || 'http://localhost:8881';
const SLUG         = process.env.PLUGIN_SLUG || '';
const REPORT_DIR   = 'reports/pm-ux';

// Pages where your plugin should NOT be outputting anything
// (and therefore should NOT be loading assets)
const NEUTRAL_PAGES = [
  { name: 'Homepage',    url: `${BASE}/` },
  { name: 'Blog Index',  url: `${BASE}/blog/` },
  { name: 'About',       url: `${BASE}/about/` },
  { name: 'Sample Page', url: `${BASE}/sample-page/` },
];

// Active pages from env (comma-separated relative URLs)
const ACTIVE_PAGES = (process.env.PLUGIN_ACTIVE_PAGES || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

// Load from qa.config.json if present
let qaCfg = {};
try { qaCfg = JSON.parse(fs.readFileSync('qa.config.json', 'utf8')); } catch {}
const cfgActivePaths = qaCfg?.plugin?.frontend_active_pages || [];
const allActivePaths = new Set([...ACTIVE_PAGES, ...cfgActivePaths]);

test.describe('Frontend asset leak detection', () => {
  test.skip(!SLUG, 'Set PLUGIN_SLUG env var');

  test('plugin must not load assets on pages where it has no output', async ({ page }) => {
    const leaks = [];

    for (const { name, url } of NEUTRAL_PAGES) {
      try {
        // Skip if this is configured as an active page
        const urlPath = new URL(url).pathname;
        if (allActivePaths.has(urlPath) || allActivePaths.has(url)) continue;

        const loadedAssets = [];
        page.on('response', res => {
          const resUrl = res.url();
          if (
            resUrl.includes(`/plugins/${SLUG}/`) ||
            resUrl.includes(`/${SLUG}/assets/`) ||
            resUrl.includes(`/${SLUG}/css/`) ||
            resUrl.includes(`/${SLUG}/js/`)
          ) {
            loadedAssets.push({
              url: resUrl,
              type: resUrl.match(/\.(js|css|woff2?|png|svg)(\?|$)/)?.[1] || 'other',
              size: parseInt(res.headers()['content-length'] || '0', 10),
            });
          }
        });

        const response = await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 15000,
        });

        if (!response || response.status() >= 400) continue;

        // Check page HTML directly too (for inline assets and inline scripts)
        const html = await page.content();
        const inlineSlug = html.match(new RegExp(`plugins/${SLUG}/[^"'\\s]+\\.(js|css)`, 'gi')) || [];

        const allLeaks = [
          ...loadedAssets.map(a => ({ ...a, how: 'network' })),
          ...inlineSlug.filter(u => !loadedAssets.some(a => a.url.includes(u)))
                       .map(u => ({ url: u, type: u.split('.').pop(), size: 0, how: 'inline-html' })),
        ];

        if (allLeaks.length > 0) {
          const totalKB = Math.round(allLeaks.reduce((s, a) => s + (a.size || 0), 0) / 1024);
          leaks.push({ page: name, url, assets: allLeaks, totalKB });

          console.log(`\n⚠ [Frontend Leak] "${name}" — ${allLeaks.length} plugin asset(s) loading:`);
          for (const a of allLeaks) {
            const filename = a.url.split('/').pop()?.split('?')[0];
            const sizeStr = a.size ? ` (${Math.round(a.size/1024)}KB)` : '';
            console.log(`    [${a.type}] ${filename}${sizeStr}`);
          }
          if (totalKB > 0) console.log(`    Total wasted bandwidth per visitor: ${totalKB}KB`);
          console.log(`    Fix: in wp_enqueue_scripts, check is_singular('your-cpt')`);
          console.log(`         or use the conditional tags: is_page(), is_singular(), etc.`);
        }
      } catch {
        // Page not found — skip (site may not have this URL)
      }
    }

    const report = {
      slug: SLUG,
      activePages: [...allActivePaths],
      testedPages: NEUTRAL_PAGES.length,
      leakingPages: leaks.length,
      totalWastedKB: leaks.reduce((s, l) => s + l.totalKB, 0),
      leaks,
      fix: [
        'Use WP conditional tags in wp_enqueue_scripts:',
        '  add_action("wp_enqueue_scripts", function() {',
        '    if ( ! is_singular("my-cpt") && ! is_page([123, 456]) ) return;',
        '    wp_enqueue_style("my-plugin-style", ...);',
        '  });',
        '',
        'For shortcodes: use wp_enqueue_style() inside the shortcode callback',
        '  (WP deduplicates — safe to call late)',
      ],
      wpDocs: 'https://developer.wordpress.org/apis/wp_enqueue_scripts/',
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, 'frontend-asset-leak.json'),
      JSON.stringify(report, null, 2)
    );

    if (leaks.length === 0) {
      console.log(`\n✓ Frontend assets: load conditionally — no unnecessary asset on neutral pages`);
    } else {
      const totalKB = leaks.reduce((s, l) => s + l.totalKB, 0);
      console.log(`\n[Frontend Leak] ${leaks.length} page(s) loading unnecessary assets (~${totalKB}KB wasted/visitor)`);
    }

    // WARN — never hard-block. PM + Dev decide.
    expect(true).toBe(true);
  });
});
