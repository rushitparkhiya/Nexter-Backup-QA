# Orbit Master Audit — Fix Everything Table

> **What this doc is:** A full synthesis of every known problem with Orbit — wrong skills,
> missing checks, gaps vs real-world WP QA — merged into one prioritized action plan.
> This is the source of truth for making Orbit production-grade ("Day 1 pro QA").
>
> **Research sources used:**
> - Skill file deep-reads (found the skills mismatch problem)
> - Expert WP QA research (Reddit, Patchstack, Wordfence, WP.org plugin review team docs)
> - Antigravity-awesome-skills audit (52 skills reviewed, 20 mapped to Orbit gaps)
> - 17 documented gaps from gap analysis session

---

## The #1 Problem: Wrong Skills Doing the Wrong Jobs

Before anything else — four of the six core skills in Orbit are **mismatched to their task**.
They look right from the name but do completely the wrong thing when invoked.

| Skill in AGENTS.md | What it actually does | What Orbit needs it to do | Problem severity |
|---|---|---|---|
| `/wordpress-penetration-testing` | Runs WPScan, Metasploit, brute-forces passwords, scans live URLs for CVEs | Read PHP source code, find XSS/SQLi/CSRF by reading the code | **CRITICAL** — this is an attacker tool not a code reviewer |
| `/performance-engineer` | Cloud infra: Kubernetes tuning, Prometheus dashboards, APM setup, CDN config | Find expensive WP hooks, N+1 DB queries, blocking assets in PHP code | **HIGH** — knows nothing about `add_action`, transients, or WP_Query |
| `/database-optimizer` | Enterprise DBA: PostgreSQL sharding, DynamoDB GSI design, query planner tuning | Review `$wpdb->prepare()` calls, spot autoload bloat, check transient patterns | **HIGH** — MySQL/WP-specific knowledge not guaranteed |
| `/wordpress-plugin-development` | Scaffolding workflow — generates new plugin boilerplate | Code review against WP coding standards | **MEDIUM** — generation-focused, not review-focused |

**Result:** When you run `gauntlet.sh --mode full`, Step 11 (Skill Audits) produces either empty output, wrong-domain output (Kubernetes metrics, brute-force test plans), or hallucinated results because the skill has no WP code context.

---

## Master Fix Table

> **Priority legend:**
> - `P0` — Fix before next use. Currently broken.
> - `P1` — Day 1 pro QA. Must have to be taken seriously.
> - `P2` — Day 2 / next sprint. High value, not blocking.
> - `P3` — Nice to have. Add when time permits.

> **Effort legend:** `S` = under 1hr | `M` = half day | `L` = full day | `XL` = 2+ days

---

### Part A — Skills Fixes (P0 — Fix First)

These changes go in `AGENTS.md` and optionally in custom skill `.md` files.

| # | Problem | Current | Fix | Antigravity skill to use | Priority | Effort |
|---|---------|---------|-----|--------------------------|----------|--------|
| A1 | Security skill is an attacker tool, not a PHP code reviewer | `/wordpress-penetration-testing` | Replace with code-focused security reviewers | `security-auditor` (data flow + IDOR analysis) + `security-scanning-security-sast` (PHP + Semgrep rules) | P0 | S |
| A2 | Security skill misses WP-specific patterns (nonce bypass, `is_admin()` misconception, shortcode XSS) | — | Create custom `/orbit-wp-security` skill with WP-specific vuln patterns | `xss-html-injection` + `idor-testing` + `sql-injection-testing` as reference patterns | P0 | M |
| A3 | Performance skill is cloud infra (Kubernetes/Prometheus) — wrong domain | `/performance-engineer` | Replace with WP-aware performance skill | `web-performance-optimization` (Core Web Vitals focus) + `performance-optimizer` | P0 | S |
| A4 | Performance skill doesn't know WP hook system, transients, or WP_Query | — | Create custom `/orbit-wp-performance` skill with WP hook analysis patterns | — | P1 | M |
| A5 | DB skill is enterprise DBA — doesn't know `$wpdb`, autoload, transients | `/database-optimizer` (community ver) | Verify antigravity's `database-optimizer` is WP-aware, or create `/orbit-wp-database` | `database-optimizer` from antigravity (may be better) | P0 | S |
| A6 | Code quality skill (`/code-review-excellence`) is generic PR reviewer — no WP context | `/code-review-excellence` | Add `/codebase-audit-pre-push` and `/vibe-code-auditor` for AI-generated code risk detection | `codebase-audit-pre-push` + `vibe-code-auditor` | P1 | S |
| A7 | WP plugin development skill is a scaffolding tool, not a reviewer | `/wordpress-plugin-development` | Keep as-is but add explicit "review, not scaffold" instruction in the AGENTS.md prompt | `wordpress-plugin-development` from antigravity (WP 7.0 aware) | P1 | S |

**Quick fix for P0 items — update AGENTS.md deduplication table:**

```
REPLACE:
  Security audit | /wordpress-penetration-testing + /security-auditor

WITH:
  Security audit | /security-auditor + /security-scanning-security-sast + /orbit-wp-security
  (remove /wordpress-penetration-testing — it's an attacker tool, not a PHP reviewer)

REPLACE:
  Performance | /performance-engineer

WITH:
  Performance | /web-performance-optimization + /orbit-wp-performance

REPLACE:
  DB review | /database-optimizer

WITH:
  DB review | /orbit-wp-database (or antigravity's /database-optimizer if WP-aware)
```

---

### Part B — Missing Gauntlet Steps (Add to gauntlet.sh)

These are checks that real-world WP QA engineers run that Orbit completely skips.

| # | Missing Check | Why It Matters | How to Add | Antigravity skill | Priority | Effort |
|---|---------------|----------------|-----------|-------------------|----------|--------|
| B1 | **`plugin-check` (official WP.org tool)** | This is literally what WordPress.org plugin review team runs. Catches 40+ violation categories including remote code exec, unsafe functions, `eval()`, `base64_decode()`, GPL violations, readme.txt format | Add `wp plugin check $(basename $PLUGIN_PATH)` via WP-CLI in gauntlet Step 2 (after PHPCS). Already have WP-CLI via wp-env. One line. | — | P0 | S |
| B2 | **Deprecation notice scan** | `PHP Deprecated:` notices in `wp-content/debug.log` only appear at runtime — PHPStan misses them. PHP 8.x kills entire plugin categories silently. Very common support ticket source | Parse `debug.log` after Playwright run (Step 6). `grep "Deprecated" wp-content/debug.log` and fail if any. | — | P1 | S |
| B3 | **WP-Cron verification** | Activation must register scheduled events. Deactivation must clear them. Cron failures are completely silent in WP — no error, no log | Run `wp cron event list` via WP-CLI after activation test, assert expected events exist. Run after deactivation, assert they're gone | — | P1 | S |
| B4 | **Uninstall / cleanup test** | Plugin deletion must clean up: options, custom tables, cron events, user meta, transients. WordPress.org review requires `uninstall.php`. Orphaned data = user data compliance problem | New Playwright test: deactivate → delete plugin → run `wp option list --search=<plugin_prefix>%` and assert empty. Assert custom tables dropped | — | P1 | M |
| B5 | **Memory usage profiling** | Shared hosting: 64MB or 128MB PHP memory limit. A bloated plugin can cause white screen of death for 40% of WordPress users. Not visible in Lighthouse | Add to Step 8 (DB profiling): `wp eval 'echo memory_get_peak_usage(true)/1048576;'` per page type. Warn if >10MB per page | — | P1 | S |
| B6 | **Object cache compatibility** | Transients with persistent object cache (Redis/Memcached) behave differently from DB transients. Items >1MB silently fail in Memcached. `wp_cache_add()` vs `wp_cache_set()` race conditions | Run gauntlet with Redis enabled via `wp-env` override. Add `wordpress/wp-content/object-cache.php` mock | — | P2 | L |
| B7 | **Update path / data migration test** | v1→v2 upgrade breaks settings 100% of the time if not tested. `upgrader_process_complete` hook, version-gated schema changes, Option value format changes | Create fixture with v1 data. Install v2 zip. Playwright test that asserts settings survived. Needs per-plugin fixture | — | P2 | L |
| B8 | **Multisite / network testing** | Network activation only fires on primary site. `wp_sitemeta` vs `wp_options` confusion. `manage_network_options` vs `manage_options` capability. Large agencies run multisite | Add `wp-env` multisite config. Playwright tests for network activation. WP-CLI assertions for sitemeta | — | P2 | L |
| B9 | **RTL (Right-to-Left) layout** | Arabic/Hebrew/Farsi users. CSS `float: left` without RTL override. Common WordPress.org review rejection. Invisible on LTR-only dev setup | Playwright project with `dir="rtl"`. Screenshot baseline comparison. `body.rtl` CSS assertions | — | P2 | M |
| B10 | **Gutenberg block deprecation** | Block attribute format changes break existing user content without deprecation record. "Block validation error" = user data effectively corrupted | Playwright test: load post with existing block markup after update. Assert no block validation errors | — | P2 | M |
| B11 | **GDPR / Privacy API** | WP 4.9.6+ requires plugins storing user data to register `wp_privacy_personal_data_exporters` and `wp_privacy_personal_data_erasers`. WordPress.org review checks this | Add PHPCS sniff or grep scan: if plugin uses `add_user_meta()` / `create_table()`, require privacy hook registration | `privacy-by-design` (antigravity) | P2 | M |
| B12 | **Large dataset / scale test** | `WP_Query` with `posts_per_page => -1`. `get_all_meta()` patterns. Works with 5 posts, breaks with 10,000. Invisible until production | wp-env fixture script generating 1,000+ posts/users before gauntlet. Assert query time stays under threshold | — | P3 | XL |
| B13 | **Admin color scheme compatibility** | 8 built-in WP admin color schemes. Hardcoded `#0073aa` blue fails on Ectoplasm/Ocean/Sunrise. Very common in plugin admin UIs | Playwright visual test cycling through all 8 color schemes. Screenshot diff | — | P3 | M |
| B14 | **Asset loading on wp-login.php** | Many plugins accidentally enqueue scripts on login page. Slows login. Causes JS errors for users. Not caught by any current step | Playwright: check `wp-login.php` network requests. Assert no plugin assets loaded (check for plugin slug in asset URLs) | — | P3 | S |
| B15 | **Keyboard navigation flow test** | axe-core catches static ARIA violations. Does NOT test: can you Tab through a modal? Is focus trapped? Can keyboard users reach every setting? | Playwright keyboard nav test: Tab through settings page, assert no focus traps, assert all interactive elements reachable | `fixing-accessibility` + `wcag-audit-patterns` | P2 | M |
| B16 | **Translation completeness test** | i18n step wraps strings but never loads an actual `.mo` file. Mistranslated format strings crash PHP. `sprintf(__('%s'), ...)` with wrong arg count | Generate `.mo` file from `.pot`. Load it in wp-env. Run Playwright tests with it active. Assert no PHP warnings | — | P3 | M |
| B17 | **Application Passwords (REST auth)** | WP REST API auth only tests cookie auth. WP Application Passwords (5.6+) not tested. Different auth path has different security surface | Add REST API Playwright test using `Authorization: Basic base64(user:app-password)`. Assert CRUD operations work | `api-security-testing` | P3 | M |

---

### Part C — Antigravity Skills to Install

Install these from `https://github.com/sickn33/antigravity-awesome-skills` and update `AGENTS.md`.

| Skill | What it does | Which Orbit gap it fixes | Add-on trigger | Priority |
|-------|-------------|--------------------------|----------------|----------|
| `security-auditor` | Data flow analysis, IDOR, privilege escalation, access control logic | Replaces broken `/wordpress-penetration-testing` for PHP code review | Always (core 6) | P0 |
| `security-scanning-security-sast` | PHP static analysis, Semgrep/CodeQL patterns, secrets detection | Source code security scan — what pen-test skill should have been | Always (core 6) | P0 |
| `vibe-code-auditor` | Detects AI-generated code risks: hallucinated APIs, silent failures, wrong WP function usage | Critical for AI-assisted plugins (Cursor/GitHub Copilot) | Always (core 6) | P1 |
| `codebase-audit-pre-push` | Full pre-release code audit checklist | Strengthens Step 11 code quality check | Always (core 6) | P1 |
| `web-performance-optimization` | Core Web Vitals, WP-specific performance patterns | Replaces broken `/performance-engineer` for WP context | Always (core 6) | P0 |
| `semgrep-rule-creator` | Creates custom Semgrep rules for WP-specific patterns (nonce bypass, `is_admin()`, shortcode XSS) | Enables custom WP security rules in Step 2 PHPCS | Advanced mode | P1 |
| `xss-html-injection` | XSS pattern detection and exploitation patterns | Security deep-dive for Step 11 | Security-heavy plugins | P1 |
| `idor-testing` | IDOR / broken object-level authorization detection | REST API plugins. `permission_callback` present but no object ownership check | REST API plugins | P1 |
| `sql-injection-testing` | SQL injection pattern matching — ORDER BY/LIMIT injection (not caught by `$wpdb->prepare()`) | DB security in Step 11 | All plugins with search/sort | P1 |
| `fixing-accessibility` | File-by-file accessibility fixes | Complements axe-core with fix implementation | Always | P1 |
| `wcag-audit-patterns` | WCAG 2.2 AA patterns, screen reader testing | Strengthens Step 11 accessibility audit | Always | P1 |
| `privacy-by-design` | Privacy by design patterns, data minimization, consent | GDPR/Privacy API gap (B11) | Plugins storing user data | P2 |
| `wordpress-plugin-development` (antigravity ver) | WP 7.0 features: Abilities API, AI Connectors, RTC | Updates WP standard checks for WP 7.x | Always | P1 |
| `wordpress-penetration-testing` (antigravity ver) | WP 7.0 attack surfaces — but still an attacker tool | NOT for code review. Use for live staging audit only | Staging audit only | P2 |
| `database-optimizer` (antigravity ver) | Check if this is WP-aware — if so, better than community ver | DB review in Step 11 | Always | P1 |
| `k6-load-testing` | Load testing setup | Scale testing (B12) | Performance plugins | P3 |
| `screen-reader-testing` | Screen reader compatibility | Accessibility deep-dive | Admin UI plugins | P2 |
| `php-pro` | PHP 8.x patterns, type safety, named args, match expressions | PHP 8.x deprecation patterns | PHP-heavy plugins | P1 |
| `production-code-audit` | Production readiness review | Release gate quality check | Always | P2 |
| `clean-code` | SOLID, DRY, complexity reduction | Code quality in Step 11 | Always | P3 |

---

### Part D — Security Patterns Currently Missed by PHPCS + Current Skills

These are real CVEs and real plugin vulnerabilities that the current gauntlet **will not catch**.
They require the custom WP security skill (`/orbit-wp-security`) described in Part A.

| Vulnerability Pattern | Why Current Gauntlet Misses It | Example | CVE/Reference |
|---|---|---|---|
| `is_admin()` misconception | PHPCS allows it. The security skill doesn't know WP's auth model | `is_admin()` returns `true` for unauthenticated `admin-ajax.php` requests | Patchstack 2024 — 100+ plugins |
| Conditional nonce bypass | PHPCS checks nonce presence, not the logic | `if (isset($_POST['nonce']) && !wp_verify_nonce(...))` — omitting nonce bypasses the check entirely | OWASP CSRF bypass |
| Shortcode attribute Stored XSS | `wp_kses_post()` doesn't sanitize shortcode attrs. PHPCS passes this. | `$atts['link'] = $atts['link']` → output via `echo $link` | 100+ plugins, 6M sites (Patchstack) |
| ORDER BY / LIMIT SQL injection | `$wpdb->prepare()` cannot parameterize these clauses — PHPCS passes prepared statements | `$wpdb->query("SELECT * FROM posts ORDER BY " . $_GET['order'])` | Common in table plugins |
| PHP Object Injection | PHPCS doesn't flag `unserialize()` with DB-sourced data | `unserialize(get_option('plugin_data'))` where user can write option | OWASP OI |
| `wp_ajax_nopriv_` + `update_option()` | PHPCS doesn't correlate hook type with action | Unauthenticated AJAX that calls `update_option('admin_email', ...)` | Site takeover |
| Privilege escalation via `update_user_meta()` | No capability check before meta update | `update_user_meta($user_id, 'wp_capabilities', ['administrator'])` | ProfileGrid CVE-2024 |
| Missing object-level auth in REST endpoints | `permission_callback` exists but doesn't check ownership | User can PATCH `/wp/v2/posts/123` even if they don't own post 123 | IDOR — common in headless plugins |
| `wp_cache_set()` race condition | No static analysis detects this logic bug | Inventory counter decremented twice simultaneously | Cache/WooCommerce patterns |
| Transient silent failure with object cache | Runtime only — PHPStan/PHPCS can't catch | `set_transient()` stores nothing with persistent cache if key >250 chars | Redis/Memcached production |

---

### Part E — New Custom Skill Files to Create

Create these files at `~/.claude/skills/orbit-wp-security/SKILL.md` etc. They override the mismatched community skills.

| File to create | Replaces | What it should instruct Claude to do |
|---|---|---|
| `~/.claude/skills/orbit-wp-security/SKILL.md` | `/wordpress-penetration-testing` (for code review) | Read PHP source. Check: nonce verification logic, `is_admin()` misuse, output escaping, capability checks, SQL parameterization including ORDER BY/LIMIT, object injection via `unserialize()`, AJAX hook auth correlation, privilege escalation via meta functions. No WPScan, no live URL scanning. |
| `~/.claude/skills/orbit-wp-performance/SKILL.md` | `/performance-engineer` | WP-specific only. Check: hook load order, hooks running on every page vs conditional, N+1 inside `foreach` over WP_Query results, `get_option()` in loops, assets enqueued globally vs page-specific, autoload option bloat, transient abuse (setting transients in every page load rather than caching). |
| `~/.claude/skills/orbit-wp-database/SKILL.md` | `/database-optimizer` | WP-specific MySQL. Check: `$wpdb->prepare()` on all user-controlled values including ORDER BY/LIMIT, missing `dbDelta()` for custom tables (not raw CREATE TABLE), autoload => 'no' for large options, transient cleanup patterns, `get_posts()` vs direct `$wpdb->get_results()` tradeoffs, missing indexes on custom tables, no `delete_option()` in `uninstall.php`. |
| `~/.claude/skills/orbit-wp-standards/SKILL.md` | `/wordpress-plugin-development` (for review) | WP code standards review only — not scaffolding. Check: text domain consistency, nonce field naming, prefixing all globals with plugin slug, no namespace collisions, enqueue hook timing (must use `wp_enqueue_scripts` not `init`), sanitize-on-input + escape-on-output rule, activation hook safety, `register_activation_hook()` vs `plugins_loaded`. |

---

### Part F — Quick Wins for gauntlet.sh (Add These Today)

These are all single-command additions that catch real bugs with near-zero effort.

```bash
# ── NEW STEP 2b: WordPress.org Plugin Check (after PHPCS) ──────────────────
header "Step 2b: WordPress.org Plugin Check (official)"
if command -v wp &>/dev/null; then
  WP_CHECK_OUT=$(wp plugin check "$(basename $PLUGIN_PATH)" \
    --path="$(wp eval 'echo ABSPATH;' 2>/dev/null)" \
    --format=summary 2>&1 || true)
  WP_CHECK_ERRORS=$(echo "$WP_CHECK_OUT" | grep -c "ERROR" || echo "0")
  if [ "$WP_CHECK_ERRORS" -eq 0 ]; then
    ok "WP Plugin Check — passed (WP.org review ready)"
  else
    fail "WP Plugin Check — $WP_CHECK_ERRORS errors (would be rejected by WP.org)"
    ((FAIL++))
  fi
else
  warn "WP-CLI not found — skipping plugin-check"
fi

# ── NEW STEP 6c: Deprecation Notice Scan (after Playwright) ────────────────
header "Step 6c: PHP Deprecation Notice Scan"
DEBUG_LOG="$(wp eval 'echo WP_CONTENT_DIR;' 2>/dev/null)/debug.log"
if [ -f "$DEBUG_LOG" ]; then
  DEPRECATED=$(grep "PHP Deprecated" "$DEBUG_LOG" | grep -i "$(basename $PLUGIN_PATH)" | wc -l | tr -d ' ')
  if [ "$DEPRECATED" -eq 0 ]; then
    ok "No PHP deprecation notices in debug.log"
    ((PASS++))
  else
    warn "$DEPRECATED PHP Deprecated notices — review for PHP 8.x compat"
    grep "PHP Deprecated" "$DEBUG_LOG" | grep -i "$(basename $PLUGIN_PATH)" | head -5
    ((WARN++))
  fi
else
  warn "debug.log not found — enable WP_DEBUG_LOG for deprecation scan"
fi

# ── NEW STEP 8b: Memory Profiling (after DB profiling) ─────────────────────
header "Step 8b: Memory Profiling"
PEAK_MEM=$(wp eval 'echo memory_get_peak_usage(true) / 1048576;' 2>/dev/null || echo "?")
if [ "$PEAK_MEM" != "?" ]; then
  PEAK_INT=${PEAK_MEM%.*}
  if [ "$PEAK_INT" -lt 32 ]; then
    ok "Peak memory: ${PEAK_MEM}MB (good — under 32MB)"
    ((PASS++))
  elif [ "$PEAK_INT" -lt 64 ]; then
    warn "Peak memory: ${PEAK_MEM}MB (acceptable — watch on shared hosting)"
    ((WARN++))
  else
    fail "Peak memory: ${PEAK_MEM}MB (HIGH — will crash on 64MB shared hosting)"
    ((FAIL++))
  fi
fi

# ── NEW STEP 5b: WP-Cron Assertions (after activation test) ────────────────
header "Step 5b: WP-Cron Event Verification"
if command -v wp &>/dev/null; then
  CRON_EVENTS=$(wp cron event list --format=count 2>/dev/null || echo "0")
  ok "Cron event count after activation: $CRON_EVENTS"
  log "- Cron events registered: $CRON_EVENTS (verify expected events are present)"
  # Manual: verify expected hook names from qa.config.json cron_hooks array
fi
```

---

## Day 1 Action Checklist

Complete these in order. After this list, Orbit covers 99% of pro QA requirements.

### Hour 1 — Fix the broken skills

- [ ] Update `AGENTS.md` deduplication table: remove `/wordpress-penetration-testing` from code review path, replace with `security-auditor` + `security-scanning-security-sast`
- [ ] Update `AGENTS.md`: replace `/performance-engineer` with `web-performance-optimization`
- [ ] Update `gauntlet.sh` Step 11: swap skill names in the `claude` invocations to match new AGENTS.md
- [ ] Install antigravity skills: `security-auditor`, `security-scanning-security-sast`, `web-performance-optimization`, `vibe-code-auditor`, `codebase-audit-pre-push`, `fixing-accessibility`, `wcag-audit-patterns`

### Hour 2 — Write the 3 custom skill files

- [ ] Create `~/.claude/skills/orbit-wp-security/SKILL.md` (WP PHP code review, not attacker tool)
- [ ] Create `~/.claude/skills/orbit-wp-performance/SKILL.md` (WP hook/query performance)
- [ ] Create `~/.claude/skills/orbit-wp-database/SKILL.md` (WP MySQL/wpdb patterns)

### Hour 3 — Add quick-win gauntlet steps

- [ ] Add Step 2b (`plugin-check`) to `gauntlet.sh` — one WP-CLI command
- [ ] Add Step 6c (deprecation scan) to `gauntlet.sh` — one grep command
- [ ] Add Step 8b (memory profiling) to `gauntlet.sh` — one WP-CLI eval
- [ ] Add Step 5b (cron event list) to `gauntlet.sh` — one WP-CLI command

### Later — High-value new tests

- [ ] Write uninstall/cleanup Playwright test (checks DB is clean after plugin delete)
- [ ] Add RTL Playwright project (screenshot diff with `dir="rtl"`)
- [ ] Add multisite wp-env config + network activation test
- [ ] Write GDPR privacy API grep/PHPCS check for `wp_privacy_personal_data_*` hooks
- [ ] Add large dataset fixture generator script (1,000 posts before gauntlet)

---

## What "99% covered" means after this

After completing the Day 1 checklist:

| Category | Before | After |
|---|---|---|
| PHP code security | Attacker tool (wrong tool) | PHP source reader with WP-specific vuln patterns |
| Performance | Cloud infra skill (wrong domain) | WP hook/query/asset analysis |
| Database | Enterprise DBA (wrong dialect) | WP/MySQL specific patterns |
| WordPress.org compliance | Not checked | `plugin-check` official tool |
| PHP 8.x runtime issues | PHPStan only (static) | + deprecation log scan at runtime |
| WP-Cron bugs | Not checked | WP-CLI cron event assertions |
| Memory/shared hosting | Not checked | Peak memory profiling |
| Uninstall cleanup | Not checked | DB assertion after plugin delete (after P1 work) |
| AI-generated code risks | Not checked | `vibe-code-auditor` skill |
| WCAG keyboard nav | Static axe-core only | + Playwright keyboard Tab flow tests (P2) |
| Multisite | Not checked | wp-env multisite (P2) |
| Object cache | Not checked | Redis/Memcached compatibility (P2) |

The remaining 1% is custom JavaScript behavior and business-logic edge cases — which
you're keeping as manual/custom JS tests per the original decision.

---

## Reference: Security Vulnerability Cheat Sheet

Paste this into the `orbit-wp-security` skill file's vulnerability checklist section.

```
WP-SPECIFIC SECURITY PATTERNS TO CHECK IN SOURCE CODE:

1. is_admin() MISUSE
   BAD:  if (is_admin()) { // trust this is admin }
   NOTE: is_admin() returns true for ANY admin-ajax.php request, including unauthenticated
   FIX:  Always add capability check: current_user_can('manage_options')

2. CONDITIONAL NONCE BYPASS
   BAD:  if (isset($_POST['nonce']) && !wp_verify_nonce($_POST['nonce'], 'action')) { die(); }
   NOTE: If nonce field is simply omitted, the if-isset is false, die() never runs
   FIX:  Always: if (!isset($_POST['nonce']) || !wp_verify_nonce($_POST['nonce'], 'action')) { die(); }

3. SHORTCODE ATTRIBUTE XSS
   BAD:  function my_shortcode($atts) { return '<a href="' . $atts['url'] . '">'; }
   NOTE: wp_kses_post() does NOT sanitize shortcode attributes
   FIX:  esc_url($atts['url']) for URLs, esc_attr() for everything else

4. ORDER BY / LIMIT SQL INJECTION
   BAD:  $wpdb->query("SELECT * FROM {$wpdb->posts} ORDER BY " . $_GET['orderby']);
   NOTE: $wpdb->prepare() CANNOT parameterize ORDER BY or LIMIT clauses
   FIX:  Use allowlist: $allowed = ['date','title']; if (!in_array($_GET['orderby'], $allowed)) die();

5. OBJECT INJECTION VIA UNSERIALIZE
   BAD:  $data = unserialize(get_option('my_plugin_data'));
   NOTE: If user can control the option value, they can inject PHP objects
   FIX:  Use json_decode/json_encode instead. If serialize needed, use wp_unslash + hash verify

6. NOPRIV AJAX + OPTION UPDATE
   BAD:  add_action('wp_ajax_nopriv_my_action', 'my_handler');
         function my_handler() { update_option('blogname', $_POST['name']); }
   NOTE: wp_ajax_nopriv_ fires for ALL logged-out users including bots
   FIX:  Require nonce + capability or remove nopriv entirely

7. PRIVILEGE ESCALATION VIA USER META
   BAD:  update_user_meta($_POST['user_id'], 'wp_capabilities', $_POST['caps']);
   NOTE: No ownership check — user A can escalate user B or themselves
   FIX:  Check current_user_can('edit_users') AND verify $user_id === get_current_user_id()
         OR current_user_can('edit_user', $user_id)

8. REST API IDOR (BROKEN OBJECT LEVEL AUTH)
   BAD:  register_rest_route('plugin/v1', '/post/(?P<id>\d+)', [
           'permission_callback' => function() { return is_user_logged_in(); },
           'callback' => function($req) { return update_post($req['id'], $req['data']); }
         ]);
   NOTE: Auth checks login but not ownership — any logged-in user can edit any post
   FIX:  Add: if (!current_user_can('edit_post', $req['id'])) { return new WP_Error('forbidden'); }
```

---

*Last updated: April 2026 — Orbit v1.x — adityaarsharma/orbit*
