// @ts-check
/**
 * Orbit — WordPress 7.0 Connectors / Abilities API Security
 *
 * Real WP 7.0 API (per make.wordpress.org/core/2026/03/18):
 *   - Abilities register via the `abilities_api_init` hook using WP_Ability-derived classes
 *   - Connector keys stored in a dedicated `wp_connectors` table (NOT wp_options)
 *   - Option-prefix convention: `connector_{provider}_{key_name}`
 *   - Keys are NOT encrypted in the DB (UI-masked only)
 *   - No per-plugin scoping — every installed plugin can retrieve every key
 *   - Agent-vs-human caller context passed via ability invocation metadata
 *
 * Skip this spec unless the plugin actually uses Connectors/Abilities API.
 *
 * Usage:
 *   PLUGIN_SLUG=my-plugin PLUGIN_USES_CONNECTORS=1 \
 *   npx playwright test wp7-connectors.spec.js
 */

const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');

const PLUGIN_SLUG     = (process.env.PLUGIN_SLUG || '').replace(/[^a-zA-Z0-9_-]/g, '');
const USES_CONNECTORS = process.env.PLUGIN_USES_CONNECTORS === '1';
const WP_ENV_RUN      = process.env.WP_ENV_RUN || 'npx wp-env run cli wp';

function wp(cmd) {
  try { return execSync(`${WP_ENV_RUN} ${cmd}`, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim(); }
  catch (e) { return ''; }
}

// Serial — mutates connector state
test.describe.configure({ mode: 'serial' });

test.describe('WP 7.0 Connectors / Abilities API — security', () => {
  test.skip(!USES_CONNECTORS || !PLUGIN_SLUG,
    'Set PLUGIN_SLUG + PLUGIN_USES_CONNECTORS=1 if plugin uses Connectors API');

  test('plugin registers abilities via abilities_api_init hook (WP_Ability class pattern)', async () => {
    // Probe for the real WP 7.0 Abilities API — class_exists WP_Ability
    const hasAbilitiesApi = wp(`eval 'echo class_exists("WP_Ability") ? "y" : "n";'`);
    if (hasAbilitiesApi !== 'y') {
      test.skip(true, 'WP 7.0 Abilities API not present on this site');
      return;
    }

    // Fire abilities_api_init to populate the registry, then query it
    const abilitiesJson = wp(`eval '
      do_action("abilities_api_init");
      if (!function_exists("wp_get_registered_abilities")) { echo "[]"; exit; }
      $all = wp_get_registered_abilities();
      $mine = array_filter($all, function($a) {
        return strpos($a->get_id(), "'"$PLUGIN_SLUG"'") === 0;
      });
      echo json_encode(array_map(function($a){ return $a->get_id(); }, array_values($mine)));
    '`);

    let mine = [];
    try { mine = JSON.parse(abilitiesJson || '[]'); } catch {}

    expect(mine.length,
      `Plugin ${PLUGIN_SLUG} should register at least one ability via abilities_api_init (WP_Ability class)`
    ).toBeGreaterThan(0);
  });

  test('Connector keys do not leak in debug.log after plugin operations', async () => {
    // Connectors API uses wp_connectors table per make.wp.org/core/2026/03/18
    // Option-prefix fallback: connector_{provider}_{key_name}
    const SENTINEL = 'sk-ORBIT-TEST-SENTINEL-DO-NOT-LEAK-' + Date.now();

    // Set via both possible storage mechanisms (table + option fallback)
    wp(`eval '
      if (function_exists("wp_store_connector_key")) {
        wp_store_connector_key("anthropic", "api_key", "${SENTINEL}");
      } else {
        update_option("connector_anthropic_api_key", "${SENTINEL}");
      }
    '`);

    // Exercise plugin operations that might log
    wp(`cron event run --due-now 2>&1 || true`);
    wp(`eval 'do_action("init"); do_action("admin_init");'`);

    // Check debug.log doesn't contain the sentinel
    const logContent = wp(`eval '
      $log = WP_CONTENT_DIR . "/debug.log";
      echo file_exists($log) ? file_get_contents($log) : "";
    '`);

    expect(logContent,
      'Connector key leaked to debug.log — redact sensitive options before any logging'
    ).not.toContain(SENTINEL);

    // Cleanup
    wp(`eval '
      if (function_exists("wp_delete_connector_key")) {
        wp_delete_connector_key("anthropic", "api_key");
      } else {
        delete_option("connector_anthropic_api_key");
      }
    '`);
  });

  test('agent-invoked abilities still enforce permission callbacks', async () => {
    // WP 7.0: abilities pass caller metadata. Agent calls with unprivileged user
    // should still be blocked by the ability's permission_callback.
    const hasInvoke = wp(`eval 'echo function_exists("wp_execute_ability") ? "y" : "n";'`);
    if (hasInvoke !== 'y') {
      test.skip(true, 'WP 7.0 wp_execute_ability not present');
      return;
    }

    // Pick the first plugin-owned ability and attempt invocation as guest
    const result = wp(`eval '
      wp_set_current_user(0);
      do_action("abilities_api_init");
      $all = wp_get_registered_abilities();
      $mine = array_values(array_filter($all, function($a) {
        return strpos($a->get_id(), "'"$PLUGIN_SLUG"'") === 0;
      }));
      if (empty($mine)) { echo "no-abilities"; exit; }
      $r = wp_execute_ability($mine[0]->get_id(), [], ["caller" => "agent"]);
      echo is_wp_error($r) ? "blocked:" . $r->get_error_code() : "allowed";
    '`);

    if (result === 'no-abilities') {
      test.skip(true, 'No plugin-owned abilities to test invocation against');
      return;
    }

    expect(result,
      `Unauthenticated agent call succeeded — permission_callback is missing or too permissive`
    ).toMatch(/^blocked:/);
  });
});
