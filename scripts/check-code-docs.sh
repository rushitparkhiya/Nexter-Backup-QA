#!/usr/bin/env bash
# Orbit — Code Documentation Quality Check
#
# What this checks:
#   1. PHPDoc coverage — every public function/class/method has a docblock
#   2. @since tags — new functions have the version they were added
#   3. @param and @return — type information documented
#   4. Inline change comments — major logic blocks have version context
#   5. File-level docblocks — every PHP file has a file header
#   6. TODO/FIXME tracking — unfixed items flagged
#   7. Changelog sync — every @since version exists in CHANGELOG
#
# Usage:
#   bash scripts/check-code-docs.sh /path/to/plugin [--version 2.4.0]

set -euo pipefail

PLUGIN_PATH="${1:-}"
CURRENT_VERSION="${2:-}"

[ -z "$PLUGIN_PATH" ] && { echo "Usage: $0 /path/to/plugin [version]"; exit 1; }
[ ! -d "$PLUGIN_PATH" ] && { echo "Not a dir: $PLUGIN_PATH"; exit 1; }

# Auto-detect version from plugin header if not provided
if [ -z "$CURRENT_VERSION" ]; then
  CURRENT_VERSION=$(grep -r "Version:" "$PLUGIN_PATH"/*.php 2>/dev/null | \
    grep -oE "[0-9]+\.[0-9]+(\.[0-9]+)?" | head -1 || echo "")
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; }
info() { echo -e "${CYAN}    $1${NC}"; }

FAIL=0; WARN=0; PASS=0

PHP_FILES=$(find "$PLUGIN_PATH" -name "*.php" \
  -not -path "*/vendor/*" \
  -not -path "*/node_modules/*" \
  -not -name "uninstall.php" 2>/dev/null)

TOTAL_FILES=$(echo "$PHP_FILES" | wc -l | tr -d ' ')

echo ""
echo -e "${BOLD}[ Code Documentation Check ]${NC}"
echo -e "  Plugin: ${YELLOW}$(basename "$PLUGIN_PATH")${NC} | Version: ${CURRENT_VERSION:-auto-detect}"
echo -e "  PHP files: $TOTAL_FILES"
echo ""

# ── 1. Function PHPDoc Coverage ───────────────────────────────────────────────
echo -e "${BOLD}  1/7 PHPDoc Coverage (public functions)${NC}"

TOTAL_FUNCS=$(grep -rn "^[[:space:]]*\(public\|protected\|private\)\?[[:space:]]*function " \
  "$PLUGIN_PATH" --include="*.php" --exclude-dir=vendor --exclude-dir=node_modules 2>/dev/null | \
  wc -l | tr -d ' ' || echo "0")

# Functions preceded by a docblock (/** ... */ on the line before)
DOCUMENTED_FUNCS=$(python3 -c "
import re, os, glob

plugin_path = '$PLUGIN_PATH'
total = 0
documented = 0

for root, dirs, files in os.walk(plugin_path):
    dirs[:] = [d for d in dirs if d not in ['vendor', 'node_modules']]
    for f in files:
        if not f.endswith('.php'):
            continue
        try:
            content = open(os.path.join(root, f)).read()
            lines = content.split('\n')
            for i, line in enumerate(lines):
                if re.match(r'\s*(public|protected|private)?\s*function\s+\w+', line):
                    total += 1
                    # Check preceding lines for docblock
                    for j in range(max(0, i-8), i):
                        if '/**' in lines[j] or '@param' in lines[j] or '@return' in lines[j]:
                            documented += 1
                            break
        except:
            pass

print(f'{documented}/{total}')
" 2>/dev/null || echo "?/?")

DOCUMENTED=$(echo "$DOCUMENTED_FUNCS" | cut -d/ -f1)
TOTAL=$(echo "$DOCUMENTED_FUNCS" | cut -d/ -f2)

if [ "$TOTAL" != "0" ] && [ "$TOTAL" != "?" ]; then
  PCT=$(echo "scale=0; $DOCUMENTED * 100 / $TOTAL" | bc 2>/dev/null || echo "?")
  if [ "${PCT:-0}" -ge 80 ]; then
    ok "PHPDoc coverage: $DOCUMENTED/$TOTAL functions documented ($PCT%)"
    ((PASS++))
  elif [ "${PCT:-0}" -ge 50 ]; then
    warn "PHPDoc coverage: $DOCUMENTED/$TOTAL ($PCT%) — target is 80%+"
    info "Undocumented functions make maintenance harder and reduce IDE support"
    ((WARN++))
  else
    warn "Low PHPDoc coverage: $DOCUMENTED/$TOTAL ($PCT%) — significant docs gap"
    ((WARN++))
  fi
else
  ok "PHPDoc check skipped (no public functions found or python3 unavailable)"
fi

# ── 2. @since Tag Coverage ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  2/7 @since Tag Coverage${NC}"

SINCE_COUNT=$(grep -rn "@since" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ "$SINCE_COUNT" -gt 0 ]; then
  ok "$SINCE_COUNT @since tags found"
  ((PASS++))

  # Check if current version has @since tags
  if [ -n "$CURRENT_VERSION" ]; then
    CURRENT_SINCE=$(grep -rn "@since[[:space:]]*$CURRENT_VERSION" "$PLUGIN_PATH" \
      --include="*.php" --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    if [ "$CURRENT_SINCE" -gt 0 ]; then
      ok "$CURRENT_SINCE function(s) tagged @since $CURRENT_VERSION (current version)"
    else
      warn "No @since $CURRENT_VERSION tags found"
      info "New functions added in v$CURRENT_VERSION should have @since $CURRENT_VERSION"
    fi
  fi
else
  warn "No @since tags found in codebase"
  info "@since tags are required for WordPress Plugin Repository submission"
  info "Pattern: /** @since 2.4.0 */ above each new function/class/method"
  info "Especially important for: hooks, filters, public API functions"
  ((WARN++))
fi

# ── 3. @param and @return Coverage ────────────────────────────────────────────
echo ""
echo -e "${BOLD}  3/7 @param and @return Tags${NC}"

PARAM_COUNT=$(grep -rn "@param" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")
RETURN_COUNT=$(grep -rn "@return" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ "$PARAM_COUNT" -gt 0 ] && [ "$RETURN_COUNT" -gt 0 ]; then
  ok "@param: $PARAM_COUNT tags | @return: $RETURN_COUNT tags"
  ((PASS++))
else
  warn "Low type documentation: @param: $PARAM_COUNT | @return: $RETURN_COUNT"
  info "PHPDoc types enable IDEs and static analysis. Pattern:"
  info "  /** @param string \$name The field name @return int */"
  ((WARN++))
fi

# ── 4. File-Level Docblocks ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  4/7 File-Level Docblocks${NC}"

FILES_WITH_HEADER=0
FILES_WITHOUT_HEADER=0
EXAMPLES_WITHOUT=""

while IFS= read -r file; do
  FIRST_200=$(head -c 500 "$file" 2>/dev/null || true)
  if echo "$FIRST_200" | grep -qE "/\*\*|@package|@file|@author|@copyright"; then
    FILES_WITH_HEADER=$((FILES_WITH_HEADER + 1))
  else
    FILES_WITHOUT_HEADER=$((FILES_WITHOUT_HEADER + 1))
    if [ -z "$EXAMPLES_WITHOUT" ]; then
      EXAMPLES_WITHOUT=$(basename "$file")
    fi
  fi
done <<< "$PHP_FILES"

TOTAL_CHECKED=$((FILES_WITH_HEADER + FILES_WITHOUT_HEADER))
if [ "$TOTAL_CHECKED" -gt 0 ]; then
  PCT_HEADER=$(echo "scale=0; $FILES_WITH_HEADER * 100 / $TOTAL_CHECKED" | bc 2>/dev/null || echo "?")
  if [ "${PCT_HEADER:-0}" -ge 70 ]; then
    ok "File headers: $FILES_WITH_HEADER/$TOTAL_CHECKED files have docblocks ($PCT_HEADER%)"
    ((PASS++))
  else
    warn "File headers: $FILES_WITH_HEADER/$TOTAL_CHECKED files ($PCT_HEADER%)"
    info "Files missing headers (first found): $EXAMPLES_WITHOUT"
    ((WARN++))
  fi
fi

# ── 5. Version-Tagged Change Comments ─────────────────────────────────────────
echo ""
echo -e "${BOLD}  5/7 Version-Tagged Change Comments${NC}"

CHANGE_COMMENTS=$(grep -rn "@deprecated\|// Changed in\|// Modified in\|// Since v\|// Removed in\|// Added in" \
  "$PLUGIN_PATH" --include="*.php" --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")

DEPRECATED_NO_VERSION=$(grep -rn "@deprecated" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | grep -v "[0-9]\+\.[0-9]" | wc -l | tr -d ' ' || echo "0")

if [ "$CHANGE_COMMENTS" -gt 0 ]; then
  ok "$CHANGE_COMMENTS version-tagged change comments found"
  if [ "$DEPRECATED_NO_VERSION" -gt 0 ]; then
    warn "$DEPRECATED_NO_VERSION @deprecated tags without version number"
    info "Pattern: @deprecated 2.4.0 Use new_function() instead"
  fi
  ((PASS++))
else
  warn "No version-tagged change comments found"
  info "For major changes, add comments like:"
  info "  /** @deprecated 2.4.0 — use new_function() instead. Removed in 3.0.0 */"
  info "  // Changed in 2.4.0: renamed from old_function_name() for clarity"
  ((WARN++))
fi

# ── 6. TODO / FIXME Tracking ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  6/7 TODO / FIXME Items${NC}"

TODOS=$(grep -rn "TODO\|FIXME\|HACK\|XXX\|BUG" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | grep -v "vendor" || true)
TODO_COUNT=$(echo "$TODOS" | grep -c "TODO\|FIXME\|HACK\|XXX\|BUG" || echo "0")

if [ "$TODO_COUNT" -eq 0 ]; then
  ok "No open TODO/FIXME/HACK items"
  ((PASS++))
elif [ "$TODO_COUNT" -le 5 ]; then
  warn "$TODO_COUNT open TODO/FIXME item(s) — review before release"
  echo "$TODOS" | head -5 | while read line; do
    file=$(echo "$line" | cut -d: -f1 | xargs basename)
    lineno=$(echo "$line" | cut -d: -f2)
    content=$(echo "$line" | cut -d: -f3-)
    info "  $file:$lineno — $content"
  done
  ((WARN++))
else
  warn "$TODO_COUNT open TODO/FIXME items — significant tech debt"
  echo "$TODOS" | head -8 | while read line; do
    file=$(echo "$line" | cut -d: -f1 | xargs basename)
    lineno=$(echo "$line" | cut -d: -f2)
    info "  $file:$lineno"
  done
  ((WARN++))
fi

# ── 7. CHANGELOG vs @since Sync ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}  7/7 CHANGELOG vs @since Consistency${NC}"

CHANGELOG=""
for f in "$PLUGIN_PATH/CHANGELOG.md" "$PLUGIN_PATH/CHANGELOG.txt" "$PLUGIN_PATH/changelog.md"; do
  if [ -f "$f" ]; then CHANGELOG="$f"; break; fi
done

if [ -n "$CHANGELOG" ] && [ -n "$CURRENT_VERSION" ]; then
  if grep -q "$CURRENT_VERSION" "$CHANGELOG"; then
    ok "Version $CURRENT_VERSION found in CHANGELOG"
    ((PASS++))
  else
    warn "Version $CURRENT_VERSION not found in CHANGELOG"
    info "Update CHANGELOG before tagging release $CURRENT_VERSION"
    ((WARN++))
  fi

  # Find all @since versions in code
  SINCE_VERSIONS=$(grep -rEoh "@since[[:space:]]+[0-9]+\.[0-9]+(\.[0-9]+)?" \
    "$PLUGIN_PATH" --include="*.php" --exclude-dir=vendor 2>/dev/null | \
    grep -oE "[0-9]+\.[0-9]+(\.[0-9]+)?" | sort -u || true)

  UNLOGGED=""
  for ver in $SINCE_VERSIONS; do
    if ! grep -q "$ver" "$CHANGELOG" 2>/dev/null; then
      UNLOGGED="$UNLOGGED $ver"
    fi
  done

  if [ -n "$UNLOGGED" ]; then
    warn "@since versions not in CHANGELOG:$UNLOGGED"
    info "These versions are referenced in code but not documented in changelog"
  else
    ok "All @since versions have corresponding CHANGELOG entries"
    ((PASS++))
  fi
else
  warn "CHANGELOG not found — can't verify @since sync"
  info "Add CHANGELOG.md to plugin root"
  ((WARN++))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Code Docs Check: ${GREEN}$PASS passed${NC} · ${YELLOW}$WARN warnings${NC} · ${RED}$FAIL failed${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}  Code Docs: FAILED${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}  Code Docs: WARNINGS — improve before release${NC}"
  exit 2
else
  echo -e "${GREEN}  Code Docs: PASSED${NC}"
  exit 0
fi
