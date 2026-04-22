#!/usr/bin/env bash
# Orbit — Competitor Vulnerability Intelligence
#
# What this does:
#   1. Reads competitor plugin slugs from qa.config.json (or CLI args)
#   2. Queries WPScan public API for each competitor's known CVEs
#   3. Extracts vulnerability types (SQLi, XSS, CSRF, auth bypass, etc.)
#   4. Greps own plugin code for the same code patterns that caused each vuln type
#   5. Generates a risk report: "competitor had X — do you have the same pattern?"
#
# Why this matters:
#   Competitors get patched first. Their CVEs are your early warning system.
#   If they had SQLi in their custom table queries, check if yours are safe.
#   If they had CSRF missing in AJAX handlers, check all your wp_ajax_ hooks.
#
# Usage:
#   bash scripts/check-competitor-vulns.sh /path/to/plugin [slug1 slug2 ...]
#   bash scripts/check-competitor-vulns.sh /path/to/plugin  # reads from qa.config.json
#
# Requires:
#   curl + internet access for WPScan API (no API key needed for public data)
#   python3 for JSON parsing and report generation

set -euo pipefail

PLUGIN_PATH="${1:-}"
shift || true
EXTRA_SLUGS=("$@")

[ -z "$PLUGIN_PATH" ] && { echo "Usage: $0 /path/to/plugin [competitor-slug ...]"; exit 1; }
[ ! -d "$PLUGIN_PATH" ] && { echo "Not a dir: $PLUGIN_PATH"; exit 1; }

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; }
info() { echo -e "${CYAN}    $1${NC}"; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_DIR="reports"
mkdir -p "$REPORT_DIR"
REPORT_MD="$REPORT_DIR/competitor-vulns-$TIMESTAMP.md"
REPORT_JSON="$REPORT_DIR/competitor-vulns-$TIMESTAMP.json"
OWN_SLUG=$(basename "$PLUGIN_PATH")

echo ""
echo -e "${BOLD}[ Competitor Vulnerability Intelligence ]${NC}"
echo -e "  Own plugin: ${YELLOW}$OWN_SLUG${NC}"
echo ""

# ── Load competitor slugs ──────────────────────────────────────────────────────
COMPETITOR_SLUGS=()

if [ ${#EXTRA_SLUGS[@]} -gt 0 ]; then
  COMPETITOR_SLUGS=("${EXTRA_SLUGS[@]}")
elif [ -f "qa.config.json" ]; then
  while IFS= read -r slug; do
    [ -n "$slug" ] && COMPETITOR_SLUGS+=("$slug")
  done < <(python3 -c "
import json
try:
  c = json.load(open('qa.config.json'))
  slugs = c.get('competitors', [])
  # Handle both list of strings and list of objects
  for s in slugs:
    print(s if isinstance(s, str) else s.get('slug', s.get('name', '')))
except:
  pass
" 2>/dev/null)
fi

if [ ${#COMPETITOR_SLUGS[@]} -eq 0 ]; then
  warn "No competitor slugs found. Add to qa.config.json:"
  info '  "competitors": ["yoast/wordpress-seo", "rankmath/seo-by-rank-math"]'
  info "Or pass as args: bash scripts/check-competitor-vulns.sh /path/to/plugin yoast rankmath"
  exit 2
fi

echo -e "  Checking ${#COMPETITOR_SLUGS[@]} competitor(s): ${COMPETITOR_SLUGS[*]}"
echo ""

# ── Vulnerability pattern definitions ─────────────────────────────────────────
# Maps CVE type keywords → grep patterns to check in own plugin code
declare -A VULN_PATTERNS
VULN_PATTERNS["sql_injection"]="wpdb.*\$_\|wpdb.*\$_GET\|wpdb.*\$_POST\|wpdb.*\$_REQUEST\|ORDER BY.*\$\|LIMIT.*\$\|wpdb->query.*\$"
VULN_PATTERNS["xss"]="echo.*\$_\|print.*\$_\|echo.*get_query_var\|_e(.*\$_\|echo.*\$_GET\|echo.*\$_POST"
VULN_PATTERNS["csrf"]="wp_ajax_\|admin-ajax\|admin_post_"
VULN_PATTERNS["csrf_no_nonce"]="wp_ajax_nopriv_\|admin_post_nopriv_"
VULN_PATTERNS["auth_bypass"]="is_admin()\|current_user_can.*editor\|current_user_can.*author"
VULN_PATTERNS["object_injection"]="unserialize\|maybe_unserialize"
VULN_PATTERNS["file_inclusion"]="include.*\$_\|require.*\$_\|include_once.*\$_\|require_once.*\$_"
VULN_PATTERNS["open_redirect"]="wp_redirect.*\$_\|wp_safe_redirect.*\$_GET"
VULN_PATTERNS["privilege_escalation"]="update_user_meta.*\$_\|wp_update_user.*\$_POST\|add_role\|remove_role"
VULN_PATTERNS["idor"]="get_post.*\$_POST\|get_user_by.*\$_GET\|get_comment.*\$_"

# ── Query WPScan API ───────────────────────────────────────────────────────────
COMPETITOR_DATA=()
VULN_TYPE_FREQ=()
ALL_FINDINGS=()

for slug in "${COMPETITOR_SLUGS[@]}"; do
  # Strip vendor prefix if provided (e.g. "yoast/wordpress-seo" → "wordpress-seo")
  clean_slug=$(echo "$slug" | sed 's|.*/||')

  echo -e "  ${CYAN}Querying WPScan API for: $clean_slug${NC}"

  # WPScan public API — no key required for basic vuln data
  WPSCAN_URL="https://wpscan.com/api/v3/plugins/${clean_slug}"
  API_RESPONSE=$(curl -sf --connect-timeout 10 --max-time 20 \
    -H "User-Agent: Orbit-Plugin-QA/2.4 (security research)" \
    "$WPSCAN_URL" 2>/dev/null || echo "{}")

  # Parse vulnerabilities from WPScan response
  VULN_DATA=$(python3 -c "
import json, sys

data = json.loads('''$API_RESPONSE''')
slug = '$clean_slug'

plugin_data = data.get(slug, {})
vulns = plugin_data.get('vulnerabilities', [])

results = []
for v in vulns:
  title = v.get('title', '')
  fixed_in = v.get('fixed_in', 'unfixed')
  vuln_type = v.get('vuln_type', 'UNKNOWN')
  cvss = v.get('cvss', {})
  score = cvss.get('score', 0) if cvss else 0
  refs = v.get('references', {})
  cves = refs.get('cve', []) if refs else []
  cve_str = ', '.join(['CVE-' + c for c in cves]) if cves else 'no CVE'
  results.append({
    'title': title,
    'fixed_in': fixed_in,
    'type': vuln_type,
    'cvss': score,
    'cve': cve_str,
  })

print(json.dumps(results))
" 2>/dev/null || echo "[]")

  VULN_COUNT=$(python3 -c "import json; print(len(json.loads('''$VULN_DATA''')))" 2>/dev/null || echo "0")

  if [ "$VULN_COUNT" -eq 0 ]; then
    # Fallback: check NVD keyword search
    echo -e "    ${YELLOW}WPScan: no data. Falling back to NVD keyword search...${NC}"
    NVD_URL="https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=wordpress+${clean_slug}&resultsPerPage=5"
    NVD_RESPONSE=$(curl -sf --connect-timeout 10 --max-time 20 \
      -H "User-Agent: Orbit-Plugin-QA/2.4" \
      "$NVD_URL" 2>/dev/null || echo "{}")

    VULN_DATA=$(python3 -c "
import json, re

data = json.loads('''$NVD_RESPONSE''')
vulns_raw = data.get('vulnerabilities', [])

results = []
for item in vulns_raw:
  cve = item.get('cve', {})
  cve_id = cve.get('id', '')
  descs = cve.get('descriptions', [])
  desc = next((d['value'] for d in descs if d.get('lang') == 'en'), '')
  metrics = cve.get('metrics', {})
  score = 0
  for k in ['cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']:
    m = metrics.get(k, [])
    if m:
      score = m[0].get('cvssData', {}).get('baseScore', 0)
      break

  # Classify type from description
  desc_lower = desc.lower()
  if 'sql injection' in desc_lower or 'sqli' in desc_lower:
    vuln_type = 'SQLI'
  elif 'cross-site scripting' in desc_lower or ' xss' in desc_lower:
    vuln_type = 'XSS'
  elif 'csrf' in desc_lower or 'cross-site request forgery' in desc_lower:
    vuln_type = 'CSRF'
  elif 'bypass' in desc_lower or 'unauthorized' in desc_lower:
    vuln_type = 'AUTH_BYPASS'
  elif 'privilege' in desc_lower or 'escalat' in desc_lower:
    vuln_type = 'PRIVILEGE_ESCALATION'
  elif 'injection' in desc_lower:
    vuln_type = 'INJECTION'
  elif 'file inclusion' in desc_lower or 'path traversal' in desc_lower:
    vuln_type = 'FILE_INCLUSION'
  else:
    vuln_type = 'OTHER'

  results.append({
    'title': desc[:120] + '...' if len(desc) > 120 else desc,
    'fixed_in': 'see NVD',
    'type': vuln_type,
    'cvss': score,
    'cve': cve_id,
  })

print(json.dumps(results))
" 2>/dev/null || echo "[]")

    VULN_COUNT=$(python3 -c "import json; print(len(json.loads('''$VULN_DATA''')))" 2>/dev/null || echo "0")
  fi

  if [ "$VULN_COUNT" -gt 0 ]; then
    warn "$clean_slug: $VULN_COUNT known vulnerability/vulnerabilities"
    python3 -c "
import json
vulns = json.loads('''$VULN_DATA''')
for v in vulns[:5]:
  score = v.get('cvss', 0)
  severity = 'CRITICAL' if score >= 9 else 'HIGH' if score >= 7 else 'MEDIUM' if score >= 4 else 'LOW'
  print(f\"    [{severity}] {v['type']} — {v['title'][:80]} ({v['cve']}, fixed: {v['fixed_in']})\")
" 2>/dev/null || true
  else
    ok "$clean_slug: no public CVE data found (may still have private vulns)"
  fi

  COMPETITOR_DATA+=("$clean_slug:$VULN_DATA")
done

# ── Check own plugin for vulnerability patterns ────────────────────────────────
echo ""
echo -e "${BOLD}  Own Plugin Pattern Analysis${NC}"
echo ""

declare -A OWN_MATCHES
declare -A RISK_LEVEL

for vuln_type in "${!VULN_PATTERNS[@]}"; do
  pattern="${VULN_PATTERNS[$vuln_type]}"
  matches=$(grep -rnE "$pattern" "$PLUGIN_PATH" \
    --include="*.php" --exclude-dir=vendor --exclude-dir=node_modules 2>/dev/null | \
    grep -v "//.*$pattern\|#.*$pattern" | wc -l | tr -d ' ' || echo "0")
  OWN_MATCHES[$vuln_type]=$matches
done

# ── Cross-reference: competitor had X, own plugin has pattern? ────────────────
echo -e "${BOLD}  Cross-Reference: Competitor CVEs vs Your Code${NC}"
echo ""

# Collect unique vuln types seen in competitors
COMPETITOR_VULN_TYPES=()
for entry in "${COMPETITOR_DATA[@]}"; do
  slug="${entry%%:*}"
  data="${entry#*:}"
  while IFS= read -r vtype; do
    [ -n "$vtype" ] && COMPETITOR_VULN_TYPES+=("$vtype")
  done < <(python3 -c "
import json
vulns = json.loads('''$data''')
types = set()
for v in vulns:
  types.add(v.get('type','UNKNOWN').upper())
for t in types:
  print(t)
" 2>/dev/null)
done

# Deduplicate
mapfile -t UNIQUE_VULN_TYPES < <(printf '%s\n' "${COMPETITOR_VULN_TYPES[@]}" | sort -u)

TOTAL_RISKS=0
FINDINGS=()

for vuln_type in "${UNIQUE_VULN_TYPES[@]}"; do
  # Map WPScan type to our pattern key
  case "$vuln_type" in
    SQLI|SQL_INJECTION)     pattern_key="sql_injection" ;;
    XSS|CROSS_SITE_SCRIPTING) pattern_key="xss" ;;
    CSRF)                   pattern_key="csrf" ;;
    AUTH_BYPASS|AUTHENTICATION_BYPASS) pattern_key="auth_bypass" ;;
    OBJECT_INJECTION)       pattern_key="object_injection" ;;
    FILE_INCLUSION|PATH_TRAVERSAL) pattern_key="file_inclusion" ;;
    PRIVILEGE_ESCALATION)   pattern_key="privilege_escalation" ;;
    IDOR)                   pattern_key="idor" ;;
    *)                      pattern_key="" ;;
  esac

  if [ -z "$pattern_key" ]; then
    continue
  fi

  match_count="${OWN_MATCHES[$pattern_key]:-0}"

  if [ "$match_count" -gt 0 ]; then
    # Show specific lines for review
    sample_lines=$(grep -rnE "${VULN_PATTERNS[$pattern_key]}" "$PLUGIN_PATH" \
      --include="*.php" --exclude-dir=vendor 2>/dev/null | head -3 | \
      while IFS= read -r line; do
        f=$(echo "$line" | cut -d: -f1 | xargs basename)
        n=$(echo "$line" | cut -d: -f2)
        echo "      $f:$n"
      done)

    warn "[$vuln_type] Competitor had this — $match_count matching pattern(s) in your code"
    [ -n "$sample_lines" ] && echo "$sample_lines"

    case "$vuln_type" in
      SQLI)
        info "  Review: ensure all \$wpdb->prepare() used on user input"
        info "  ORDER BY / LIMIT cannot use prepare() — use allowlist validation" ;;
      XSS)
        info "  Review: use esc_html(), esc_attr(), esc_url() before all echo"
        info "  wp_kses_post() does NOT protect against XSS in most contexts" ;;
      CSRF)
        info "  Review: every wp_ajax_ handler must call check_ajax_referer()"
        info "  Every form must output wp_nonce_field()" ;;
      AUTH_BYPASS)
        info "  Review: is_admin() returns true for unauthenticated admin-ajax requests"
        info "  Use current_user_can() for all capability checks" ;;
      OBJECT_INJECTION)
        info "  Review: never unserialize() user-controlled data"
        info "  Use wp_parse_args() or JSON instead of serialize() for storage" ;;
    esac
    FINDINGS+=("$vuln_type:$match_count")
    ((TOTAL_RISKS++))
  else
    ok "[$vuln_type] Competitor had this — no matching patterns in your code"
  fi
done

# ── Additional: CSRF check (specific — all wp_ajax_ handlers have nonce?) ─────
echo ""
echo -e "${BOLD}  AJAX Handler Nonce Audit${NC}"

AJAX_HANDLERS=$(grep -rn "wp_ajax_\|wp_ajax_nopriv_\|admin_post_" "$PLUGIN_PATH" \
  --include="*.php" --exclude-dir=vendor 2>/dev/null | grep "add_action" | wc -l | tr -d ' ' || echo "0")

NONCE_CHECKS=$(grep -rn "check_ajax_referer\|wp_verify_nonce\|verify_nonce" "$PLUGIN_PATH" \
  --include="*.php" --exclude-dir=vendor 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ "$AJAX_HANDLERS" -gt 0 ]; then
  if [ "$NONCE_CHECKS" -ge "$AJAX_HANDLERS" ]; then
    ok "AJAX nonce coverage: $NONCE_CHECKS nonce checks for $AJAX_HANDLERS handlers"
  elif [ "$NONCE_CHECKS" -gt 0 ]; then
    warn "AJAX nonce coverage: $NONCE_CHECKS nonce checks for $AJAX_HANDLERS handlers"
    info "Some wp_ajax_ handlers may be missing check_ajax_referer()"
    ((TOTAL_RISKS++))
  else
    fail "No nonce checks found for $AJAX_HANDLERS wp_ajax_ handler(s)"
    info "Every AJAX handler must call: check_ajax_referer('my_nonce', 'nonce')"
    ((TOTAL_RISKS++))
  fi
fi

# ── Write reports ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  Writing reports...${NC}"

python3 -c "
import json, datetime

own_slug = '$OWN_SLUG'
timestamp = '$TIMESTAMP'
findings_raw = '''$(printf '%s\n' "${FINDINGS[@]}")'''

findings = []
if findings_raw.strip():
  for line in findings_raw.strip().split('\n'):
    if ':' in line:
      parts = line.split(':', 1)
      findings.append({'vuln_type': parts[0], 'match_count': int(parts[1])})

competitors = []
$(for entry in "${COMPETITOR_DATA[@]}"; do
  slug="${entry%%:*}"
  data="${entry#*:}"
  echo "competitors.append({'slug': '$slug', 'vulns': json.loads(r'''$data''')})"
done)

report = {
  'generated': datetime.datetime.now().isoformat(),
  'own_plugin': own_slug,
  'competitors_checked': [c['slug'] for c in competitors],
  'total_risks': $TOTAL_RISKS,
  'competitor_cvs': competitors,
  'own_code_risks': findings,
}

with open('$REPORT_JSON', 'w') as f:
  json.dump(report, f, indent=2)

print('JSON report written.')
" 2>/dev/null || warn "JSON report generation failed"

# Write markdown report
cat > "$REPORT_MD" << MDEOF
# Competitor Vulnerability Intelligence Report
**Plugin**: $OWN_SLUG
**Generated**: $(date)
**Competitors checked**: ${#COMPETITOR_SLUGS[@]}

---

## Summary

- **Total risk patterns identified**: $TOTAL_RISKS
- **Competitors analyzed**: ${COMPETITOR_SLUGS[*]}

---

## Action Items

$(for f in "${FINDINGS[@]}"; do
  vtype="${f%%:*}"
  count="${f#*:}"
  echo "- **$vtype**: $count pattern(s) in own code matching competitor vulnerability type — manual review required"
done)

$([ ${#FINDINGS[@]} -eq 0 ] && echo "- No matching patterns found — competitor vuln types do not appear in own code")

---

## What to review

| Competitor Vuln Type | Risk | What to grep for |
|---|---|---|
| SQLI | User input in \$wpdb queries without prepare() | \`\$wpdb->query.*\$_\` |
| XSS | Echoing unsanitized user input | \`echo.*\$_GET\|echo.*\$_POST\` |
| CSRF | AJAX handlers missing nonce check | \`wp_ajax_\` without \`check_ajax_referer\` |
| AUTH_BYPASS | is_admin() used for permission checks | Replace with \`current_user_can()\` |
| OBJECT_INJECTION | unserialize() on stored or user data | Use JSON instead |

---
*Generated by Orbit — WordPress Plugin QA Framework*
MDEOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Competitor Vuln Intel: ${YELLOW}$TOTAL_RISKS risk pattern(s) to review${NC}"
echo -e "  Report: $REPORT_MD"
echo ""

if [ "$TOTAL_RISKS" -gt 0 ]; then
  echo -e "${YELLOW}  Result: REVIEW NEEDED — patterns match competitor CVE types${NC}"
  exit 2
else
  echo -e "${GREEN}  Result: CLEAN — no patterns matching competitor CVE types${NC}"
  exit 0
fi
