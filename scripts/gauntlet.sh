#!/usr/bin/env bash
# Orbit — Full Pre-Release Gauntlet
# Usage: bash scripts/gauntlet.sh --plugin /path/to/plugin [--env local|ci] [--mode full|quick]
#
# macOS note: if you see "colors not working", run: export TERM=xterm-256color

set -e
[ -z "$TERM" ] && export TERM=xterm-256color

PLUGIN_PATH=""
ENV="local"
MODE="full"
REPORT_DIR="reports"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_FILE="$REPORT_DIR/qa-report-$TIMESTAMP.md"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()     { echo -e "${GREEN}✓ $1${NC}"; }
warn()   { echo -e "${YELLOW}⚠ $1${NC}"; }
fail()   { echo -e "${RED}✗ $1${NC}"; }
header() { echo -e "\n${BOLD}[ $1 ]${NC}"; }
log()    { echo "$1" >> "$REPORT_FILE"; }

# Parse args
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --plugin) PLUGIN_PATH="$2"; shift ;;
    --env)    ENV="$2"; shift ;;
    --mode)   MODE="$2"; shift ;;
  esac
  shift
done

if [ -z "$PLUGIN_PATH" ] && [ -f "qa.config.json" ]; then
  PLUGIN_PATH=$(python3 -c "import json; print(json.load(open('qa.config.json'))['plugin']['path'])" 2>/dev/null || echo "")
fi
[ -z "$PLUGIN_PATH" ] && { echo "Usage: $0 --plugin /path/to/plugin  (or run from dir with qa.config.json)"; exit 1; }
[ ! -d "$PLUGIN_PATH" ] && { echo "Plugin path not found: $PLUGIN_PATH"; exit 1; }

mkdir -p "$REPORT_DIR"
PLUGIN_NAME=$(basename "$PLUGIN_PATH")

# Init report
cat > "$REPORT_FILE" << EOF
# Orbit Gauntlet Report
**Plugin**: $PLUGIN_NAME
**Date**: $(date)
**Mode**: $MODE / $ENV
**Path**: $PLUGIN_PATH

---

EOF

echo ""
echo -e "${BOLD}Orbit — Pre-Release Gauntlet${NC}"
echo -e "Plugin: ${YELLOW}$PLUGIN_NAME${NC} | Mode: $MODE | Env: $ENV"
echo "================================================"

PASS=0; WARN=0; FAIL=0

# ── STEP 1: PHP LINT ──────────────────────────────────────────────────────────
header "Step 1: PHP Lint"
log "## Step 1: PHP Lint"

PHP_ERRORS=$(find "$PLUGIN_PATH" -name "*.php" \
  -not -path "*/vendor/*" -not -path "*/node_modules/*" \
  -exec php -l {} \; 2>&1 | grep -v "No syntax errors" | grep -v "^$" || true)

if [ -z "$PHP_ERRORS" ]; then
  ok "PHP lint — no syntax errors"
  log "- ✓ No PHP syntax errors"
  ((PASS++))
else
  fail "PHP lint — ERRORS FOUND:"
  echo "$PHP_ERRORS"
  log "- ✗ PHP syntax errors:\n\`\`\`\n$PHP_ERRORS\n\`\`\`"
  ((FAIL++))
fi

# ── STEP 2: WORDPRESS CODING STANDARDS ───────────────────────────────────────
header "Step 2: WordPress Coding Standards (PHPCS)"
log "## Step 2: PHPCS / WPCS"

if command -v phpcs &>/dev/null; then
  PHPCS_OUT=$(phpcs \
    --standard="$(pwd)/config/phpcs.xml" \
    --extensions=php \
    --ignore=vendor,node_modules \
    --report=summary \
    "$PLUGIN_PATH" 2>&1 || true)

  ERROR_COUNT=$(echo "$PHPCS_OUT" | grep -oE '[0-9]+ ERROR' | grep -oE '[0-9]+' | head -1 || echo "0")
  WARN_COUNT=$(echo "$PHPCS_OUT"  | grep -oE '[0-9]+ WARNING' | grep -oE '[0-9]+' | head -1 || echo "0")

  if [ "$ERROR_COUNT" -eq 0 ] && [ "$WARN_COUNT" -lt 10 ]; then
    ok "PHPCS — $ERROR_COUNT errors, $WARN_COUNT warnings"
    log "- ✓ PHPCS: $ERROR_COUNT errors, $WARN_COUNT warnings"
    ((PASS++))
  elif [ "$ERROR_COUNT" -gt 0 ]; then
    fail "PHPCS — $ERROR_COUNT errors, $WARN_COUNT warnings"
    log "- ✗ PHPCS: $ERROR_COUNT errors, $WARN_COUNT warnings"
    ((FAIL++))
  else
    warn "PHPCS — $WARN_COUNT warnings (review needed)"
    log "- ⚠ PHPCS: $WARN_COUNT warnings"
    ((WARN++))
  fi
else
  warn "phpcs not installed — skipping. Run: composer global require squizlabs/php_codesniffer"
  log "- ⚠ PHPCS: skipped (not installed)"
  ((WARN++))
fi

# ── STEP 3: PHPSTAN STATIC ANALYSIS ──────────────────────────────────────────
header "Step 3: PHPStan Static Analysis"
log "## Step 3: PHPStan"

if command -v phpstan &>/dev/null; then
  PHPSTAN_OUT=$(phpstan analyse \
    --configuration="$(pwd)/config/phpstan.neon" \
    --no-progress \
    "$PLUGIN_PATH/includes" 2>&1 || true)

  if echo "$PHPSTAN_OUT" | grep -q "No errors"; then
    ok "PHPStan — no errors"
    log "- ✓ PHPStan: clean"
    ((PASS++))
  else
    PHPSTAN_ERRORS=$(echo "$PHPSTAN_OUT" | tail -5)
    warn "PHPStan — issues found (review)"
    log "- ⚠ PHPStan:\n\`\`\`\n$PHPSTAN_ERRORS\n\`\`\`"
    ((WARN++))
  fi
else
  warn "phpstan not installed — skipping"
  log "- ⚠ PHPStan: skipped"
  ((WARN++))
fi

# ── STEP 4: ASSET WEIGHT ─────────────────────────────────────────────────────
header "Step 4: Asset Weight Audit"
log "## Step 4: Asset Weight"

JS_SIZE=$(find "$PLUGIN_PATH" -name "*.js" -not -path "*/node_modules/*" \
  -not -name "*.min.js" 2>/dev/null | xargs wc -c 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
CSS_SIZE=$(find "$PLUGIN_PATH" -name "*.css" -not -path "*/node_modules/*" 2>/dev/null \
  | xargs wc -c 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
JS_MB=$(echo "scale=2; $JS_SIZE/1048576" | bc 2>/dev/null || echo "?")
CSS_KB=$(echo "scale=0; $CSS_SIZE/1024" | bc 2>/dev/null || echo "?")

ok "JS total: ${JS_MB}MB | CSS total: ${CSS_KB}KB"
log "- JS total: ${JS_MB}MB | CSS total: ${CSS_KB}KB"
((PASS++))

# ── STEP 5: i18n / POT FILE CHECK ─────────────────────────────────────────────
header "Step 5: i18n / POT File"
log "## Step 5: i18n / POT"

if command -v wp &>/dev/null; then
  POT_OUT=$(cd "$PLUGIN_PATH" && wp i18n make-pot . /tmp/orbit-check.pot --skip-audit 2>&1 || true)
  UNWRAPPED=$(grep -rE "echo\s+['\"]" "$PLUGIN_PATH" --include="*.php" \
    --exclude-dir=vendor --exclude-dir=node_modules 2>/dev/null \
    | grep -vE "(__\(|_e\(|esc_html__|esc_attr__|_x\(|_n\()" | wc -l | tr -d ' ')

  if [ -f "/tmp/orbit-check.pot" ]; then
    STRINGS=$(grep -c '^msgid "' /tmp/orbit-check.pot || echo "0")
    ok "POT generated — $STRINGS translatable strings"
    log "- ✓ POT generated: $STRINGS strings"
    if [ "$UNWRAPPED" -gt 0 ]; then
      warn "$UNWRAPPED possibly untranslated echo strings — review"
      log "- ⚠ $UNWRAPPED possibly untranslated strings"
      ((WARN++))
    else
      ((PASS++))
    fi
    rm -f /tmp/orbit-check.pot
  else
    warn "POT generation failed — check plugin header + text domain"
    log "- ⚠ POT generation failed"
    ((WARN++))
  fi
else
  warn "wp-cli not installed — skipping i18n check"
  log "- ⚠ i18n: skipped (wp-cli missing)"
  ((WARN++))
fi

# ── STEP 6: PLAYWRIGHT FUNCTIONAL + VISUAL TESTS ─────────────────────────────
header "Step 6: Playwright Functional + Visual + UI Audit Tests"
log "## Step 6: Playwright"

PW_CONFIG="tests/playwright/playwright.config.js"

if command -v npx &>/dev/null && [ -f "$PW_CONFIG" ]; then
  # Ensure auth file exists — run setup project first if not
  if [ ! -f ".auth/wp-admin.json" ]; then
    echo "  Running auth setup (one-time)..."
    WP_TEST_URL="${WP_TEST_URL:-http://localhost:8881}" \
      npx playwright test --config="$PW_CONFIG" --project=setup 2>/dev/null || true
  fi

  # Run all tests: functional (chromium) + visual snapshots + UI audit
  PLAYWRIGHT_OUT=$(WP_TEST_URL="${WP_TEST_URL:-http://localhost:8881}" \
    npx playwright test --config="$PW_CONFIG" \
    --project=chromium --project=visual \
    --reporter=line 2>&1 || true)

  PASSED=$(echo "$PLAYWRIGHT_OUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1 || echo "0")
  FAILED=$(echo "$PLAYWRIGHT_OUT" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' | head -1 || echo "0")

  # Always generate HTML report
  HTML_REPORT="reports/playwright-html/index.html"
  if [ "$FAILED" -eq 0 ]; then
    ok "Playwright — $PASSED tests passed"
    log "- ✓ Playwright: $PASSED passed, 0 failed"
    ((PASS++))
  else
    fail "Playwright — $FAILED failed, $PASSED passed"
    log "- ✗ Playwright: $FAILED failed, $PASSED passed"
    ((FAIL++))
  fi
  log "- HTML report: $HTML_REPORT"
  echo -e "  ${CYAN}HTML report:${NC} $(pwd)/$HTML_REPORT"
  echo -e "  ${CYAN}View with:${NC} npx playwright show-report reports/playwright-html"

  # ── STEP 6b: Flow comparison videos (feeds PM HTML report) ─────────────────
  FLOW_SPECS=$(find tests/playwright/flows -name "*.spec.js" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$FLOW_SPECS" -gt 0 ]; then
    echo ""
    echo -e "  ${CYAN}Running $FLOW_SPECS flow spec(s) with video recording...${NC}"
    mkdir -p reports/screenshots/flows-compare reports/videos

    WP_TEST_URL="${WP_TEST_URL:-http://localhost:8881}" \
      npx playwright test --config="$PW_CONFIG" \
      --project=video \
      --reporter=line 2>&1 | tail -5 || true

    FLOW_SNAPS=$(ls reports/screenshots/flows-compare/*.png 2>/dev/null | wc -l | tr -d ' ')
    FLOW_VIDS=$(find reports/videos -name "*.webm" -o -name "*.mp4" 2>/dev/null | wc -l | tr -d ' ')
    ok "Flow videos: $FLOW_VIDS videos | $FLOW_SNAPS screenshots"
    log "- ✓ Flow recording: $FLOW_VIDS videos, $FLOW_SNAPS screenshots"

    # Generate deep PM HTML report
    UAT_HTML="reports/uat-report-$TIMESTAMP.html"
    python3 scripts/generate-uat-report.py \
      --title "UAT Report — $(date +%Y-%m-%d)" \
      --snaps "reports/screenshots/flows-compare" \
      --videos "reports/videos" \
      --out "$UAT_HTML" 2>/dev/null && {
      ok "PM report generated: $UAT_HTML"
      log "- ✓ PM report: $UAT_HTML"
      echo -e "  ${CYAN}Open report:${NC} open $(pwd)/$UAT_HTML"
      ((PASS++))
    } || {
      warn "PM report generation failed — run: python3 scripts/generate-uat-report.py"
      log "- ⚠ PM report: generation failed"
      ((WARN++))
    }
  fi
else
  warn "Playwright not configured — skipping. Run: npm install && npx playwright install"
  log "- ⚠ Playwright: skipped (not configured)"
  ((WARN++))
fi

# ── STEP 7: LIGHTHOUSE PERFORMANCE ───────────────────────────────────────────
if [ "$MODE" = "full" ]; then
  header "Step 7: Lighthouse Performance"
  log "## Step 7: Lighthouse"

  WP_LOCAL_URL="${WP_TEST_URL:-http://localhost:8881}"

  if command -v lighthouse &>/dev/null; then
    mkdir -p reports/lighthouse
    LHCI_OUT=$(lighthouse "$WP_LOCAL_URL" \
      --output=json \
      --output-path="reports/lighthouse/lh-$TIMESTAMP.json" \
      --chrome-flags="--headless --no-sandbox" \
      --quiet 2>&1 || true)

    if [ -f "reports/lighthouse/lh-$TIMESTAMP.json" ]; then
      SCORE=$(python3 -c "
import json
with open('reports/lighthouse/lh-$TIMESTAMP.json') as f:
    d = json.load(f)
print(int(d['categories']['performance']['score']*100))
" 2>/dev/null || echo "?")

      if [ "$SCORE" != "?" ] && [ "$SCORE" -ge 80 ]; then
        ok "Lighthouse performance: $SCORE/100"
        log "- ✓ Lighthouse: $SCORE/100"
        ((PASS++))
      elif [ "$SCORE" != "?" ]; then
        warn "Lighthouse performance: $SCORE/100 (target: 80+)"
        log "- ⚠ Lighthouse: $SCORE/100"
        ((WARN++))
      fi
    fi
  else
    warn "Lighthouse not installed — skipping. Install: npm install -g lighthouse"
    log "- ⚠ Lighthouse: skipped (install with: npm install -g lighthouse)"
    ((WARN++))
  fi
fi

# ── STEP 8: DB PROFILING (local only) ─────────────────────────────────────────
if [ "$MODE" = "full" ] && [ "$ENV" = "local" ]; then
  header "Step 8: Database Profiling"
  log "## Step 8: Database"
  bash scripts/db-profile.sh 2>/dev/null || warn "DB profiling failed — see docs/database-profiling.md"
  log "- See reports/db-profile-$TIMESTAMP.txt"
fi

# ── STEP 9: COMPETITOR COMPARISON (auto from qa.config.json) ──────────────────
if [ -f "qa.config.json" ]; then
  COMPETITORS_JSON=$(python3 -c "import json; c=json.load(open('qa.config.json')).get('competitors',[]); print(','.join(c))" 2>/dev/null || echo "")
  if [ -n "$COMPETITORS_JSON" ]; then
    header "Step 9: Competitor Comparison"
    log "## Step 9: Competitor Comparison"
    bash scripts/competitor-compare.sh 2>/dev/null && {
      ok "Competitor analysis complete — see reports/competitor-*.md"
      log "- ✓ Competitor: see reports/competitor-*.md"
      ((PASS++))
    } || {
      warn "Competitor analysis failed — run manually: bash scripts/competitor-compare.sh"
      log "- ⚠ Competitor: failed"
      ((WARN++))
    }
  fi
fi

# ── STEP 10: UI / FRONTEND PERFORMANCE ────────────────────────────────────────
if [ "$MODE" = "full" ]; then
  header "Step 10: UI / Frontend Performance"
  log "## Step 10: UI Performance"

  PLUGIN_TYPE=$(python3 -c "import json; print(json.load(open('qa.config.json'))['plugin']['type'])" 2>/dev/null || echo "general")
  WP_PERF_URL="${WP_TEST_URL:-http://localhost:8881}"

  # Editor performance (Elementor or Gutenberg editor load time)
  if [ "$PLUGIN_TYPE" = "elementor-addon" ] || [ "$PLUGIN_TYPE" = "gutenberg-blocks" ]; then
    if [ -f "scripts/editor-perf.sh" ]; then
      EDITOR_REPORT="reports/editor-perf-$TIMESTAMP.json"
      REPORT_PATH="$EDITOR_REPORT" bash scripts/editor-perf.sh \
        --url "$WP_PERF_URL" 2>/dev/null && {
        ok "Editor performance measured — see $EDITOR_REPORT"
        log "- ✓ Editor perf: $EDITOR_REPORT"
        ((PASS++))
      } || {
        warn "Editor perf failed — run manually: bash scripts/editor-perf.sh"
        log "- ⚠ Editor perf: failed"
        ((WARN++))
      }
    fi
  else
    # For SEO/WooCommerce/general plugins: measure frontend page load via curl
    LOAD_TIME=$(curl -o /dev/null -s -w "%{time_total}" "$WP_PERF_URL" 2>/dev/null || echo "?")
    TTFB=$(curl -o /dev/null -s -w "%{time_starttransfer}" "$WP_PERF_URL" 2>/dev/null || echo "?")
    if [ "$LOAD_TIME" != "?" ]; then
      LOAD_MS=$(echo "$LOAD_TIME * 1000" | bc 2>/dev/null | cut -d. -f1 || echo "?")
      TTFB_MS=$(echo "$TTFB * 1000" | bc 2>/dev/null | cut -d. -f1 || echo "?")
      ok "Frontend: total ${LOAD_MS}ms | TTFB ${TTFB_MS}ms"
      log "- ✓ Frontend load: ${LOAD_MS}ms | TTFB: ${TTFB_MS}ms"
      ((PASS++))
    else
      warn "Frontend perf check failed — is wp-env running? Start with: bash scripts/create-test-site.sh"
      log "- ⚠ Frontend perf: could not reach $WP_PERF_URL"
      ((WARN++))
    fi
  fi
fi

# ── STEP 11: CLAUDE SKILL AUDITS ──────────────────────────────────────────────
# Runs all 6 mandatory Orbit skills in parallel via Antigravity / claude CLI.
# Skills: WP standards · Security · Performance · DB · Accessibility · Code Quality
# Each skill writes a markdown file. After all finish, a consolidated HTML report
# is generated at reports/skill-audits/index.html — always output to file, never
# terminal-only.

if [ "$MODE" = "full" ] && command -v claude &>/dev/null && [ -n "$PLUGIN_PATH" ]; then
  header "Step 11: Claude Skill Audits (6 parallel)"
  log "## Step 11: Skill Audits"

  SKILL_REPORT_DIR="reports/skill-audits"
  mkdir -p "$SKILL_REPORT_DIR"

  echo -e "  ${CYAN}Running 6 parallel skill audits on $PLUGIN_PATH...${NC}"
  echo -e "  ${CYAN}This takes 3-6 minutes. Reports stream to $SKILL_REPORT_DIR/\n${NC}"

  # 1. WP Standards
  claude "/wordpress-plugin-development
Audit the WordPress plugin at: $PLUGIN_PATH
Check: naming conventions, escaping, nonce usage, capability checks, hooks, i18n.
Rate each finding Critical / High / Medium / Low. List all issues with file:line references.
Output a full markdown report with a severity summary table at the top." \
    > "$SKILL_REPORT_DIR/wp-standards.md" 2>/dev/null &
  PID_WP=$!

  # 2. Security / Penetration Testing
  claude "/wordpress-penetration-testing
Security audit the WordPress plugin at: $PLUGIN_PATH
Check: XSS, CSRF, SQLi, auth bypass, path traversal, privilege escalation — OWASP Top 10 for WordPress.
Rate each finding Critical / High / Medium / Low with CVSS context.
Output a full markdown report with a severity summary table at the top." \
    > "$SKILL_REPORT_DIR/security.md" 2>/dev/null &
  PID_SEC=$!

  # 3. Performance Engineering
  claude "/performance-engineer
Analyze performance of the WordPress plugin at: $PLUGIN_PATH
Check: expensive hook callbacks, N+1 DB calls, heavy asset loading, blocking scripts, unnecessary autoload.
Rank all issues by frontend and admin impact.
Output a full markdown report with a severity summary table at the top." \
    > "$SKILL_REPORT_DIR/performance.md" 2>/dev/null &
  PID_PERF=$!

  # 4. Database Optimizer
  claude "/database-optimizer
Review all database usage in the WordPress plugin at: $PLUGIN_PATH
Check: N+1 query patterns, missing indexes, raw SQL without wpdb->prepare(), autoload bloat, transient misuse.
List every fix with corrected SQL examples where applicable.
Output a full markdown report with a severity summary table at the top." \
    > "$SKILL_REPORT_DIR/database.md" 2>/dev/null &
  PID_DB=$!

  # 5. Accessibility (WCAG 2.2 AA)
  claude "/accessibility-compliance-accessibility-audit
Audit the WordPress plugin at: $PLUGIN_PATH for accessibility compliance.
Check: admin UI keyboard navigation, ARIA roles/labels, color contrast, focus management, screen reader output, block editor output.
Standard: WCAG 2.2 AA. Rate each issue Critical / High / Medium / Low.
Output a full markdown report with a severity summary table at the top." \
    > "$SKILL_REPORT_DIR/accessibility.md" 2>/dev/null &
  PID_A11Y=$!

  # 6. Code Quality Review
  claude "/code-review-excellence
Review the code quality of the WordPress plugin at: $PLUGIN_PATH
Check: dead code, cyclomatic complexity, error handling gaps, type safety, readability, PHP 8.x compatibility.
Rate each issue High / Medium / Low. Include refactor suggestions.
Output a full markdown report with a severity summary table at the top." \
    > "$SKILL_REPORT_DIR/code-quality.md" 2>/dev/null &
  PID_CQ=$!

  # Wait for all 6
  wait $PID_WP $PID_SEC $PID_PERF $PID_DB $PID_A11Y $PID_CQ 2>/dev/null

  # Report results
  SKILL_FILES=$(ls "$SKILL_REPORT_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
  SKILL_HTML="$SKILL_REPORT_DIR/index.html"

  if [ "$SKILL_FILES" -gt 0 ]; then
    ok "Skill audits complete — $SKILL_FILES reports written"
    log "- ✓ Skill audits: $SKILL_FILES markdown reports in $SKILL_REPORT_DIR/"
    ((PASS++))

    # ── Generate consolidated HTML report ─────────────────────────────────────
    python3 - <<PYEOF
import os, re, html, datetime

skill_dir = "$SKILL_REPORT_DIR"
plugin_name = "$PLUGIN_NAME"
timestamp_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

# Map filename → display label
skill_labels = {
    "wp-standards.md":   ("WP Standards",  "#3b82f6"),
    "security.md":       ("Security",      "#ef4444"),
    "performance.md":    ("Performance",   "#f59e0b"),
    "database.md":       ("Database",      "#8b5cf6"),
    "accessibility.md":  ("Accessibility", "#10b981"),
    "code-quality.md":   ("Code Quality",  "#6366f1"),
}

sev_pat = re.compile(r'\b(Critical|High|Medium|Low)\b', re.IGNORECASE)
sev_colors = {"critical":"#ef4444","high":"#f97316","medium":"#eab308","low":"#22c55e"}

def md_to_html(text):
    """Minimal markdown → HTML: headers, bold, code, hr, lists, severity badges."""
    lines = text.split('\n')
    out = []
    in_code = False
    in_table = False
    for line in lines:
        # Fenced code blocks
        if line.strip().startswith('```'):
            if in_code:
                out.append('</code></pre>')
                in_code = False
            else:
                lang = line.strip()[3:].strip()
                out.append(f'<pre><code class="lang-{html.escape(lang)}">')
                in_code = True
            continue
        if in_code:
            out.append(html.escape(line))
            continue
        # Table detection
        if '|' in line and line.strip().startswith('|'):
            if not in_table:
                out.append('<table>')
                in_table = True
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if all(re.match(r'^[-: ]+$', c) for c in cells):
                continue  # separator row
            tag = 'th' if not any(out[-1].startswith('<tr') for _ in [1]) else 'td'
            out.append('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in cells) + '</tr>')
            continue
        elif in_table:
            out.append('</table>')
            in_table = False
        # Headers
        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            lvl = len(m.group(1))
            txt = html.escape(m.group(2))
            out.append(f'<h{lvl}>{txt}</h{lvl}>')
            continue
        # HR
        if re.match(r'^---+$', line.strip()):
            out.append('<hr>')
            continue
        # List items
        m2 = re.match(r'^(\s*[-*+]|\s*\d+\.)\s+(.*)', line)
        if m2:
            txt = html.escape(m2.group(2))
            txt = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', txt)
            txt = re.sub(r'`(.*?)`', r'<code>\1</code>', txt)
            # Severity badge
            def badge(m):
                sev = m.group(1).lower()
                col = sev_colors.get(sev, "#888")
                return f'<span class="badge" style="background:{col}">{m.group(1)}</span>'
            txt = sev_pat.sub(badge, txt)
            out.append(f'<li>{txt}</li>')
            continue
        # Paragraph
        if line.strip():
            txt = html.escape(line)
            txt = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', txt)
            txt = re.sub(r'`(.*?)`', r'<code>\1</code>', txt)
            def badge(m):
                sev = m.group(1).lower()
                col = sev_colors.get(sev, "#888")
                return f'<span class="badge" style="background:{col}">{m.group(1)}</span>'
            txt = sev_pat.sub(badge, txt)
            out.append(f'<p>{txt}</p>')
        else:
            out.append('')
    if in_code:
        out.append('</code></pre>')
    if in_table:
        out.append('</table>')
    return '\n'.join(out)

# Count severity totals across all files
total_counts = {"critical":0,"high":0,"medium":0,"low":0}
sections = []
for fname, (label, color) in skill_labels.items():
    fpath = os.path.join(skill_dir, fname)
    if not os.path.exists(fpath):
        continue
    with open(fpath) as f:
        content = f.read()
    for sev in total_counts:
        total_counts[sev] += len(re.findall(sev, content, re.IGNORECASE))
    body_html = md_to_html(content)
    sections.append((label, color, fname, body_html))

# Build nav tabs
nav = ''.join(
    f'<button class="tab-btn" data-target="tab-{i}" style="border-top:3px solid {color}">{label}</button>'
    for i, (label, color, _, _) in enumerate(sections)
)

# Build tab panels
panels = ''.join(
    f'<div class="tab-panel" id="tab-{i}"><div class="skill-body">{body}</div></div>'
    for i, (_, _, _, body) in enumerate(sections)
)

sev_bar = ''.join(
    f'<span class="sev-chip" style="background:{sev_colors[s]}">{total_counts[s]} {s.title()}</span>'
    for s in ["critical","high","medium","low"]
)

html_out = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orbit Skill Audit — {html.escape(plugin_name)}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6}}
  header{{background:#1e293b;padding:20px 32px;border-bottom:1px solid #334155}}
  header h1{{font-size:1.4rem;font-weight:700;color:#f8fafc}}
  header p{{color:#94a3b8;font-size:.875rem;margin-top:4px}}
  .sev-bar{{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}}
  .sev-chip{{padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:600;color:#fff}}
  .tabs{{display:flex;gap:0;overflow-x:auto;background:#1e293b;border-bottom:1px solid #334155;padding:0 32px}}
  .tab-btn{{padding:12px 18px;background:none;border:none;border-top:3px solid transparent;color:#94a3b8;cursor:pointer;font-size:.85rem;font-weight:500;white-space:nowrap;transition:color .15s}}
  .tab-btn:hover,.tab-btn.active{{color:#f8fafc}}
  .tab-btn.active{{background:#0f172a}}
  .tab-panel{{display:none;padding:32px;max-width:1200px;margin:0 auto}}
  .tab-panel.active{{display:block}}
  .skill-body h1{{font-size:1.5rem;margin:24px 0 8px;color:#f8fafc}}
  .skill-body h2{{font-size:1.2rem;margin:20px 0 8px;color:#e2e8f0;padding-bottom:4px;border-bottom:1px solid #334155}}
  .skill-body h3{{font-size:1rem;margin:16px 0 6px;color:#cbd5e1}}
  .skill-body h4,.skill-body h5,.skill-body h6{{margin:12px 0 4px;color:#94a3b8}}
  .skill-body p{{margin:8px 0;color:#cbd5e1}}
  .skill-body li{{margin:4px 0 4px 20px;color:#cbd5e1}}
  .skill-body pre{{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:16px;overflow-x:auto;margin:12px 0}}
  .skill-body code{{font-family:'JetBrains Mono',monospace;font-size:.82rem;color:#7dd3fc}}
  .skill-body p code,.skill-body li code{{background:#1e293b;padding:1px 5px;border-radius:3px;color:#7dd3fc}}
  .skill-body hr{{border:none;border-top:1px solid #334155;margin:20px 0}}
  .skill-body strong{{color:#f8fafc}}
  .skill-body table{{width:100%;border-collapse:collapse;margin:12px 0;font-size:.85rem}}
  .skill-body td,.skill-body th{{border:1px solid #334155;padding:8px 12px;text-align:left}}
  .skill-body th{{background:#1e293b;color:#f8fafc;font-weight:600}}
  .skill-body tr:nth-child(even){{background:#1a2744}}
  .badge{{padding:1px 8px;border-radius:999px;font-size:.72rem;font-weight:700;color:#fff}}
  footer{{text-align:center;padding:24px;color:#475569;font-size:.8rem;border-top:1px solid #1e293b}}
</style>
</head>
<body>
<header>
  <h1>Orbit Skill Audit Report</h1>
  <p>Plugin: <strong>{html.escape(plugin_name)}</strong> &nbsp;·&nbsp; Generated: {timestamp_str} &nbsp;·&nbsp; {len(sections)} skills run</p>
  <div class="sev-bar">{sev_bar}</div>
</header>
<div class="tabs">{nav}</div>
<div class="panels">{panels}</div>
<footer>Generated by <strong>Orbit</strong> — WordPress Plugin QA Framework</footer>
<script>
  const btns = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  function activate(i) {{
    btns.forEach((b,j) => b.classList.toggle('active', i===j));
    panels.forEach((p,j) => p.classList.toggle('active', i===j));
  }}
  btns.forEach((b,i) => b.addEventListener('click', () => activate(i)));
  activate(0);
</script>
</body>
</html>"""

with open("$SKILL_HTML", "w") as f:
    f.write(html_out)
print("HTML report written.")
PYEOF

    if [ -f "$SKILL_HTML" ]; then
      ok "Skill audit HTML report: $SKILL_HTML"
      log "- ✓ Skill audit HTML: $SKILL_HTML"
      echo -e "  ${CYAN}Open:${NC} open $(pwd)/$SKILL_HTML"
    else
      warn "HTML generation failed — markdown reports still available in $SKILL_REPORT_DIR/"
      log "- ⚠ Skill audit HTML: generation failed (markdown reports available)"
    fi

    # Surface critical findings
    CRIT=$(grep -rl "Critical\|CRITICAL" "$SKILL_REPORT_DIR/"*.md 2>/dev/null | wc -l | tr -d ' ')
    if [ "$CRIT" -gt 0 ]; then
      warn "Critical findings found — review $SKILL_REPORT_DIR/security.md before release"
      log "- ⚠ Critical findings in $CRIT skill report(s)"
      ((WARN++))
    fi
  else
    warn "Skill audits produced no output — run manually: claude '/wordpress-penetration-testing Audit $PLUGIN_PATH'"
    log "- ⚠ Skill audits: no output"
    ((WARN++))
  fi
elif [ "$MODE" = "full" ] && [ -n "$PLUGIN_PATH" ]; then
  echo -e "  ${YELLOW}Skill audits: claude CLI not found. Install: npm install -g @anthropic-ai/claude-code${NC}"
  echo -e "  ${YELLOW}Re-run gauntlet after install for all 6 automated skill audits.${NC}"
fi

# ── FINAL REPORT ──────────────────────────────────────────────────────────────
header "Results"
log "---"
log "## Summary"
log "- ✓ Passed: $PASS"
log "- ⚠ Warnings: $WARN"
log "- ✗ Failed: $FAIL"

echo ""
echo "================================="
echo -e "${BOLD}Results${NC}: ${GREEN}$PASS passed${NC} | ${YELLOW}$WARN warnings${NC} | ${RED}$FAIL failed${NC}"
echo ""
# Auto-generate UAT HTML report if flow screenshots exist
if [ -d "reports/screenshots/flows-compare" ] && ls reports/screenshots/flows-compare/*.png &>/dev/null; then
  UAT_HTML="reports/uat-compare-$TIMESTAMP.html"
  python3 scripts/generate-uat-report.py \
    --title "UAT Flow Report — $(date +%Y-%m-%d)" \
    --out "$UAT_HTML" \
    --snaps "reports/screenshots/flows-compare" \
    --videos "reports/videos" 2>/dev/null && {
    ok "UAT HTML report generated: $UAT_HTML"
  } || true
fi

echo -e "${BOLD}Reports generated:${NC}"
echo "  MD report:      $(pwd)/$REPORT_FILE"
echo "  Playwright:     $(pwd)/reports/playwright-html/index.html"
echo "  Screenshots:    $(pwd)/reports/screenshots/"
echo "  Videos:         $(pwd)/reports/videos/"
[ -f "reports/skill-audits/index.html" ] && echo "  Skill audits:   $(pwd)/reports/skill-audits/index.html"
for f in reports/uat-report-*.html; do [ -f "$f" ] && echo "  UAT report:     $(pwd)/$f"; done
echo ""
echo -e "${CYAN}View Playwright:${NC}   npx playwright show-report reports/playwright-html"
echo -e "${CYAN}View skill audits:${NC} open reports/skill-audits/index.html"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}✗ GAUNTLET FAILED — do not release${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}⚠ GAUNTLET PASSED WITH WARNINGS — review before release${NC}"
  exit 0
else
  echo -e "${GREEN}✓ GAUNTLET PASSED — ready to release${NC}"
  exit 0
fi
