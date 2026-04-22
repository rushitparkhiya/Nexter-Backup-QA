#!/usr/bin/env bash
# Orbit — Database Schema Review & Architecture Recommendations
#
# Problem: Plugins blindly create custom DB tables when existing WordPress
# tables + proper indexing would work better. Custom tables = migration burden,
# upgrade complexity, and data orphaning on uninstall.
#
# What this checks:
#   1. Every CREATE TABLE in the plugin code
#   2. For each table: column types, indexes, charset, collation
#   3. Recommends: use existing WP tables vs custom table (with reasoning)
#   4. Checks dbDelta() usage (required for safe table creation/upgrades)
#   5. Checks for missing indexes on frequently-queried columns
#   6. Flags autoload bloat in wp_options usage
#   7. Checks for proper schema versioning (db_version option)
#
# Usage:
#   bash scripts/check-db-schema.sh /path/to/plugin

set -euo pipefail

PLUGIN_PATH="${1:-}"
[ -z "$PLUGIN_PATH" ] && { echo "Usage: $0 /path/to/plugin"; exit 1; }
[ ! -d "$PLUGIN_PATH" ] && { echo "Not a dir: $PLUGIN_PATH"; exit 1; }

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; }
info() { echo -e "${CYAN}    $1${NC}"; }
rec()  { echo -e "${CYAN}    → $1${NC}"; }

FAIL=0; WARN=0; PASS=0

echo ""
echo -e "${BOLD}[ Database Schema Review ]${NC}"
echo -e "  Plugin: ${YELLOW}$(basename "$PLUGIN_PATH")${NC}"
echo ""

# ── 1. Find all CREATE TABLE statements ───────────────────────────────────────
echo -e "${BOLD}  1/7 Custom Table Detection${NC}"

CREATE_FILES=$(grep -rlE "CREATE TABLE" "$PLUGIN_PATH" \
  --include="*.php" --exclude-dir=vendor --exclude-dir=node_modules 2>/dev/null || true)

if [ -z "$CREATE_FILES" ]; then
  ok "No CREATE TABLE statements — plugin uses existing WP tables"
  ((PASS++))
else
  TABLE_COUNT=$(grep -rEo "CREATE TABLE[^;]+" "$PLUGIN_PATH" \
    --include="*.php" --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ')
  warn "Found $TABLE_COUNT custom table creation(s)"
  echo ""
  info "Tables detected:"

  grep -rEn "CREATE TABLE[^(]+" "$PLUGIN_PATH" --include="*.php" \
    --exclude-dir=vendor 2>/dev/null | while read -r hit; do
    file=$(echo "$hit" | cut -d: -f1)
    line=$(echo "$hit" | cut -d: -f2)
    stmt=$(echo "$hit" | cut -d: -f3-)
    table=$(echo "$stmt" | grep -oE 'CREATE TABLE[^(]+' | sed 's/CREATE TABLE[[:space:]]*//' | tr -d '`" ')
    info "  $table  ($(basename "$file"):$line)"
  done

  echo ""
  echo -e "${BOLD}  Custom Table Decision Framework:${NC}"
  echo ""
  info "  USE existing WP tables when:"
  info "    wp_options     → plugin settings, key-value data, < 1000 rows"
  info "    wp_postmeta    → data attached to posts/pages/CPTs (use sparingly — can bloat)"
  info "    wp_usermeta    → data attached to users"
  info "    wp_termmeta    → data attached to taxonomy terms"
  info "    wp_comments    → user-submitted entries with parent/child relationships"
  echo ""
  info "  CREATE CUSTOM TABLE when:"
  info "    > 10,000 rows expected"
  info "    Complex JOIN queries needed (multiple relationships)"
  info "    Frequent inserts/updates (wp_postmeta is slow at scale)"
  info "    Structured relational data not fitting WP's EAV model"
  info "    Logging / event data needing date-range queries"
  echo ""
  ((WARN++))
fi

# ── 2. dbDelta() usage check ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  2/7 dbDelta() Usage (Required for Safe Schema Updates)${NC}"

if [ -n "$CREATE_FILES" ]; then
  DBDELTA_COUNT=$(grep -rl "dbDelta" "$PLUGIN_PATH" \
    --include="*.php" --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ')

  if [ "$DBDELTA_COUNT" -gt 0 ]; then
    ok "dbDelta() used for table creation/updates"
    info "dbDelta() handles schema migrations safely — existing tables are ALTERed, not re-created"
    ((PASS++))
  else
    fail "CREATE TABLE found but dbDelta() not used"
    info "Direct CREATE TABLE will fail if table already exists (plugin update scenario)"
    info "Fix: use require_once ABSPATH . 'wp-admin/includes/upgrade.php'; dbDelta(\$sql);"
    info "dbDelta() requirements:"
    info "  - Column types UPPERCASE (VARCHAR, INT — not varchar, int)"
    info "  - PRIMARY KEY must have two spaces before: '  PRIMARY KEY'"
    info "  - Each line ends with a comma EXCEPT the last field before PRIMARY KEY"
    ((FAIL++)); FAIL=1
  fi
fi

# ── 3. Index Audit ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  3/7 Index Coverage${NC}"

if [ -n "$CREATE_FILES" ]; then
  # Extract full CREATE TABLE blocks for analysis
  CREATE_BLOCKS=$(grep -rEo "CREATE TABLE[^;]+" "$PLUGIN_PATH" \
    --include="*.php" --exclude-dir=vendor 2>/dev/null || true)

  TABLES_WITH_INDEX=$(echo "$CREATE_BLOCKS" | grep -c "KEY\|INDEX" || echo "0")
  TABLES_TOTAL=$(echo "$CREATE_BLOCKS" | grep -c "CREATE TABLE" || echo "0")

  if [ "$TABLES_WITH_INDEX" -lt "$TABLES_TOTAL" ]; then
    TABLES_WITHOUT=$((TABLES_TOTAL - TABLES_WITH_INDEX))
    warn "$TABLES_WITHOUT/$TABLES_TOTAL table(s) have no indexes"
    info "Tables without indexes are slow for WHERE queries at scale"
    info "Add indexes on: foreign key columns, date/status columns used in WHERE"
    info "Example: KEY idx_user_id (user_id), KEY idx_created (created_at)"
    ((WARN++))
  else
    ok "All custom tables have at least one index"
    ((PASS++))
  fi

  # Check for common missing indexes
  COMMON_FK_COLS="user_id\|post_id\|order_id\|status\|created_at\|date_created"
  FK_WITHOUT_INDEX=$(grep -rE "$COMMON_FK_COLS" "$PLUGIN_PATH" --include="*.php" \
    --exclude-dir=vendor 2>/dev/null | grep "CREATE TABLE" -A 20 | \
    grep -v "KEY\|INDEX" | grep -E "$COMMON_FK_COLS" || true)

  if [ -n "$FK_WITHOUT_INDEX" ]; then
    info "Possibly unindexed foreign key columns detected — verify in full schema"
  fi
fi

# ── 4. wp_options Autoload Audit ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}  4/7 wp_options Autoload Audit${NC}"

AUTOLOAD_YES=$(grep -rn "add_option\|update_option" "$PLUGIN_PATH" \
  --include="*.php" --exclude-dir=vendor 2>/dev/null | \
  grep -v "autoload.*no\|autoload.*false\|'no'\|\"no\"" | wc -l | tr -d ' ' || echo "0")

AUTOLOAD_NO=$(grep -rn "add_option\|update_option" "$PLUGIN_PATH" \
  --include="*.php" --exclude-dir=vendor 2>/dev/null | \
  grep -E "autoload.*no|autoload.*false|, 'no'|, \"no\"" | wc -l | tr -d ' ' || echo "0")

LARGE_OPTION=$(grep -rn "update_option\|add_option" "$PLUGIN_PATH" \
  --include="*.php" --exclude-dir=vendor 2>/dev/null | \
  grep -E "array\s*\(|serialize\|\[" | wc -l | tr -d ' ' || echo "0")

if [ "$AUTOLOAD_YES" -gt 10 ]; then
  warn "$AUTOLOAD_YES option(s) likely autoloaded (autoload=yes is the default)"
  info "Autoloaded options are loaded on EVERY page load by WordPress"
  info "Large or many autoloaded options = bloated startup query"
  info "Fix: add_option('key', 'value', '', 'no') — the 4th param is autoload"
  info "     update_option('key', 'value', 'no')"
  ((WARN++))
else
  ok "wp_options usage looks reasonable ($AUTOLOAD_YES options)"
  ((PASS++))
fi

if [ "$LARGE_OPTION" -gt 0 ]; then
  warn "$LARGE_OPTION option(s) store arrays/serialized data — watch size"
  info "Large options (>1MB) slow down every page. Consider: custom table, transients, or wp_cache"
fi

if [ "$AUTOLOAD_NO" -gt 0 ]; then
  ok "$AUTOLOAD_NO option(s) explicitly set autoload=no — good practice"
fi

# ── 5. Schema Versioning ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  5/7 Schema Version Tracking${NC}"

if [ -n "$CREATE_FILES" ]; then
  DB_VERSION=$(grep -rl "db_version\|database_version\|db_ver\|schema_version" \
    "$PLUGIN_PATH" --include="*.php" --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ')

  if [ "$DB_VERSION" -gt 0 ]; then
    ok "Schema versioning pattern detected (db_version option)"
    info "Schema migrations should: compare stored version → current version → run upgrade"
    ((PASS++))
  else
    warn "No schema version tracking found"
    info "Without versioning, you can't run safe migrations on plugin update"
    info "Pattern:"
    info "  \$installed = get_option('my_plugin_db_version', '0');"
    info "  if (version_compare(\$installed, MY_PLUGIN_DB_VERSION, '<')) {"
    info "    my_plugin_run_migrations(\$installed);"
    info "    update_option('my_plugin_db_version', MY_PLUGIN_DB_VERSION, 'no');"
    info "  }"
    ((WARN++))
  fi
fi

# ── 6. Transient Usage Pattern ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  6/7 Transient Usage${NC}"

TRANSIENT_SET=$(grep_count() { grep -rn "$1" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' '; }
  grep_count "set_transient")
TRANSIENT_GET=$(grep -rn "get_transient" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")
TRANSIENT_NO_EXPIRY=$(grep -rn "set_transient" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | grep -E "set_transient\s*\([^,]+,\s*[^,]+\s*\)" | wc -l | tr -d ' ' || echo "0")

if [ "$TRANSIENT_SET" -gt 0 ]; then
  ok "Transients used for caching ($TRANSIENT_SET set, $TRANSIENT_GET get)"
  if [ "$TRANSIENT_NO_EXPIRY" -gt 0 ]; then
    warn "$TRANSIENT_NO_EXPIRY transient(s) set without expiry time"
    info "Transients without expiry never auto-delete — must be manually cleared"
    info "Fix: set_transient('key', \$data, HOUR_IN_SECONDS) — always set expiry"
    ((WARN++))
  fi
  ((PASS++))
fi

# ── 7. Object Cache Compatibility ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}  7/7 Object Cache Compatibility${NC}"

WP_CACHE_SET=$(grep -rn "wp_cache_set\|wp_cache_add" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")
WP_CACHE_GET=$(grep -rn "wp_cache_get" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")

EXPENSIVE_QUERIES=$(grep -rn "\$wpdb->get_results\|\$wpdb->get_row\|WP_Query\|get_posts" \
  "$PLUGIN_PATH" --include="*.php" --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ "$EXPENSIVE_QUERIES" -gt 5 ] && [ "$WP_CACHE_GET" -eq 0 ]; then
  warn "$EXPENSIVE_QUERIES DB queries found but no wp_cache_get() usage"
  info "Sites with Redis/Memcache benefit hugely from wp_cache layer"
  info "Pattern: \$result = wp_cache_get('my_key', 'my_group');"
  info "         if (false === \$result) { \$result = \$wpdb->get_results(...);"
  info "           wp_cache_set('my_key', \$result, 'my_group', HOUR_IN_SECONDS); }"
  ((WARN++))
elif [ "$WP_CACHE_GET" -gt 0 ]; then
  ok "wp_cache layer used ($WP_CACHE_GET get + $WP_CACHE_SET set calls)"
  ((PASS++))
else
  ok "No expensive queries requiring cache layer detected"
  ((PASS++))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  DB Schema Review: ${GREEN}$PASS passed${NC} · ${YELLOW}$WARN warnings${NC} · ${RED}$FAIL failed${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}  Schema Review: FAILED${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}  Schema Review: WARNINGS — review before release${NC}"
  exit 2
else
  echo -e "${GREEN}  Schema Review: PASSED${NC}"
  exit 0
fi
