#!/usr/bin/env bash
# Orbit — Full GDPR Compliance Check
#
# Covers everything the basic check-gdpr-hooks.sh misses:
#   1. WP Privacy API hooks (exporter + eraser)
#   2. Cookie declaration audit (what cookies does the plugin set?)
#   3. Third-party script loading without consent
#   4. Email collection: opt-in pattern check (consent checkbox, unsubscribe)
#   5. Privacy policy integration (wp_add_privacy_policy_content)
#   6. Data encryption check (are sensitive values stored as plaintext?)
#   7. Data minimization (is plugin collecting more than needed?)
#   8. CCPA/US state privacy compliance signals
#
# Usage:
#   bash scripts/check-gdpr-full.sh /path/to/plugin

set -euo pipefail

PLUGIN_PATH="${1:-}"
[ -z "$PLUGIN_PATH" ] && { echo "Usage: $0 /path/to/plugin"; exit 1; }
[ ! -d "$PLUGIN_PATH" ] && { echo "Not a dir: $PLUGIN_PATH"; exit 1; }

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; }
info() { echo -e "${CYAN}    $1${NC}"; }

FAIL=0; WARN=0; PASS=0

grep_plugin() {
  grep -rEl "$1" "$PLUGIN_PATH" \
    --include="*.php" \
    --exclude-dir=vendor \
    --exclude-dir=node_modules 2>/dev/null | wc -l | tr -d ' '
}

grep_lines() {
  grep -rn "$1" "$PLUGIN_PATH" \
    --include="*.php" \
    --exclude-dir=vendor \
    --exclude-dir=node_modules 2>/dev/null || true
}

echo ""
echo -e "${BOLD}[ GDPR Full Compliance Check ]${NC}"
echo -e "  Plugin: ${YELLOW}$(basename "$PLUGIN_PATH")${NC}"
echo ""

# ── 1. WP Privacy API Hooks ───────────────────────────────────────────────────
echo -e "${BOLD}  1/8 WordPress Privacy API Hooks${NC}"

USER_DATA_INDICATORS=(
  'add_user_meta' 'update_user_meta' 'wp_create_user' 'wp_insert_user'
  'wp_mail' '\$_POST\[.email.\]' '\$_POST\[.name.\]'
  'stripe_' 'checkout' 'payment' 'CREATE TABLE.*user_id'
  'wc_create_order' 'WC_Order' 'subscribe' 'newsletter'
)

HAS_USER_DATA=0
for p in "${USER_DATA_INDICATORS[@]}"; do
  count=$(grep_plugin "$p")
  HAS_USER_DATA=$((HAS_USER_DATA + count))
done

if [ "$HAS_USER_DATA" -eq 0 ]; then
  ok "No user data indicators found — Privacy API hooks not required"
  ((PASS++))
else
  info "User data indicators found ($HAS_USER_DATA files)"
  EXPORTER=$(grep_plugin "wp_privacy_personal_data_exporters")
  ERASER=$(grep_plugin "wp_privacy_personal_data_erasers")
  POLICY=$(grep_plugin "wp_add_privacy_policy_content")

  if [ "$EXPORTER" -gt 0 ]; then ok "Data exporter hook registered"; ((PASS++))
  else fail "Missing: wp_privacy_personal_data_exporters"; info "Required for WP.org Admin → Tools → Export Personal Data"; FAIL=1; ((FAIL++)); fi

  if [ "$ERASER" -gt 0 ]; then ok "Data eraser hook registered"; ((PASS++))
  else fail "Missing: wp_privacy_personal_data_erasers"; info "Required for WP.org Admin → Tools → Erase Personal Data"; FAIL=1; ((FAIL++)); fi

  if [ "$POLICY" -gt 0 ]; then ok "Privacy policy content hook registered"; ((PASS++))
  else warn "Missing: wp_add_privacy_policy_content"; info "Recommended: adds suggested privacy policy text to WP privacy tool"; ((WARN++)); fi
fi

# ── 2. Cookie Declaration Audit ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}  2/8 Cookie Declaration${NC}"

SETCOOKIE_PHP=$(grep_plugin "setcookie\|setrawcookie")
JS_COOKIES=$(grep -rEn "document\.cookie\s*=" "$PLUGIN_PATH" --include="*.js" \
  --exclude-dir=vendor --exclude-dir=node_modules 2>/dev/null | wc -l | tr -d ' ' || echo "0")

if [ "$SETCOOKIE_PHP" -gt 0 ] || [ "$JS_COOKIES" -gt 0 ]; then
  warn "Plugin sets cookies: ${SETCOOKIE_PHP} PHP setcookie() + ${JS_COOKIES} JS document.cookie"
  info "Audit each cookie: is it necessary (no consent needed) or tracking (requires consent)?"
  info "Necessary: session IDs, authentication, security tokens"
  info "Tracking: analytics, preferences, marketing — require explicit consent first"

  # List the actual cookie names
  echo ""
  info "Cookie names found in PHP:"
  grep_lines "setcookie\s*(" | head -10 | while read line; do
    info "  $line"
  done
  ((WARN++))
else
  ok "No explicit cookie setting detected (may still be set by third-party SDKs)"
  ((PASS++))
fi

# ── 3. Third-Party Script Loading ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}  3/8 Third-Party Script Loading${NC}"

THIRD_PARTY_PATTERNS=(
  'google-analytics\.com'
  'googletagmanager\.com'
  'connect\.facebook\.net'
  'pixel\.facebook\.com'
  'static\.hotjar\.com'
  'cdn\.segment\.com'
  'cdn\.amplitude\.com'
  'clarity\.ms'
  'mc\.yandex\.ru'
  'platform\.twitter\.com'
)

THIRD_PARTY_FOUND=0
for pattern in "${THIRD_PARTY_PATTERNS[@]}"; do
  count=$(grep_plugin "$pattern")
  if [ "$count" -gt 0 ]; then
    domain=$(echo "$pattern" | tr -d '\\')
    warn "Third-party script detected: $domain ($count file(s))"
    info "Ensure this loads ONLY after user consent (GDPR + ePrivacy Directive)"
    THIRD_PARTY_FOUND=1
    ((WARN++))
  fi
done

if [ "$THIRD_PARTY_FOUND" -eq 0 ]; then
  ok "No third-party tracking scripts detected in PHP source"
  ((PASS++))
fi

# Also check enqueued remote scripts
REMOTE_SCRIPTS=$(grep -rn "wp_enqueue_script.*https://" "$PLUGIN_PATH" --include="*.php" \
  --exclude-dir=vendor 2>/dev/null | grep -v 'cdn.jsdelivr\|unpkg.com\|cdnjs.cloudflare' || true)
if [ -n "$REMOTE_SCRIPTS" ]; then
  warn "Remote scripts enqueued from external domains:"
  echo "$REMOTE_SCRIPTS" | head -8 | while read line; do info "  $line"; done
  info "Verify these are either SRI-protected or load after consent"
fi

# ── 4. Email Collection Compliance ────────────────────────────────────────────
echo ""
echo -e "${BOLD}  4/8 Email Collection Compliance${NC}"

EMAIL_COLLECT=$(grep_plugin "\\\$_POST\[.email.\]\|wp_mail.*\\\$_POST\|newsletter\|subscribe.*email\|email.*subscribe")
OPT_IN_CHECKBOX=$(grep_plugin "consent.*checkbox\|gdpr.*check\|agree.*check\|terms.*check\|optin_check")
UNSUBSCRIBE=$(grep_plugin "unsubscribe\|opt.out\|remove.*list\|list.*remove")
DOUBLE_OPTIN=$(grep_plugin "double.*opt\|confirm.*email\|email.*confirm\|activation.*link")

if [ "$EMAIL_COLLECT" -gt 0 ]; then
  info "Email collection detected ($EMAIL_COLLECT files)"
  if [ "$OPT_IN_CHECKBOX" -gt 0 ]; then ok "Consent checkbox pattern found"; ((PASS++))
  else warn "No explicit consent checkbox detected for email collection"; info "GDPR requires an unchecked consent checkbox with clear description"; ((WARN++)); fi

  if [ "$UNSUBSCRIBE" -gt 0 ]; then ok "Unsubscribe/opt-out mechanism present"; ((PASS++))
  else warn "No unsubscribe mechanism found"; info "CAN-SPAM + GDPR require easy unsubscribe in all marketing emails"; ((WARN++)); fi

  if [ "$DOUBLE_OPTIN" -gt 0 ]; then ok "Double opt-in / email confirmation pattern present"; ((PASS++))
  else warn "No double opt-in detected"; info "Best practice: send confirmation email before adding to list"; ((WARN++)); fi
else
  ok "No email collection patterns detected"
  ((PASS++))
fi

# ── 5. Data Encryption for Sensitive Storage ──────────────────────────────────
echo ""
echo -e "${BOLD}  5/8 Sensitive Data Encryption${NC}"

# Look for plaintext storage of sensitive values
PLAINTEXT_SENSITIVE=$(grep -rn "update_option.*api_key\|update_option.*secret\|update_option.*password\|update_option.*token" \
  "$PLUGIN_PATH" --include="*.php" --exclude-dir=vendor 2>/dev/null | \
  grep -v "encrypted\|hash\|crypt\|wp_hash" | head -10 || true)

if [ -n "$PLAINTEXT_SENSITIVE" ]; then
  warn "Potentially storing sensitive values as plaintext in wp_options:"
  echo "$PLAINTEXT_SENSITIVE" | while read line; do info "  $line"; done
  info "Consider: encrypt with openssl_encrypt() before storing API keys/tokens"
  info "Or use: WP Application Passwords API for user credentials"
  ((WARN++))
else
  ok "No obvious plaintext sensitive value storage detected"
  ((PASS++))
fi

# ── 6. Data Minimization ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  6/8 Data Minimization${NC}"

# Check if plugin collects IP addresses
IP_COLLECT=$(grep_plugin "REMOTE_ADDR\|HTTP_X_FORWARDED_FOR\|HTTP_CLIENT_IP")
if [ "$IP_COLLECT" -gt 0 ]; then
  warn "IP address collection detected ($IP_COLLECT files)"
  info "GDPR requires justification for IP storage (legitimate interest or consent)"
  info "Best practice: anonymize IPs — store only first 3 octets (e.g. 192.168.1.x)"
  ((WARN++))
else
  ok "No IP address collection detected"
  ((PASS++))
fi

# Check for unnecessary user agent collection
UA_COLLECT=$(grep_plugin "HTTP_USER_AGENT")
if [ "$UA_COLLECT" -gt 0 ]; then
  warn "User agent string collection detected — may be personal data under GDPR"
  info "Only collect user agent if necessary for functionality (browser compat)"
  ((WARN++))
fi

# ── 7. Uninstall / Data Deletion ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}  7/8 Uninstall & Data Deletion${NC}"

if [ -f "$PLUGIN_PATH/uninstall.php" ]; then
  ok "uninstall.php exists"
  # Check it actually deletes something
  DELETES=$(grep -cE "delete_option|delete_transient|wpdb.*DROP|delete_user_meta|wp_delete_post" \
    "$PLUGIN_PATH/uninstall.php" 2>/dev/null || echo "0")
  if [ "$DELETES" -gt 0 ]; then
    ok "uninstall.php performs $DELETES deletion operation(s)"
    ((PASS++))
  else
    warn "uninstall.php exists but appears to do nothing — check for actual data deletion"
    ((WARN++))
  fi
else
  # Check if using register_uninstall_hook instead
  HOOK=$(grep_plugin "register_uninstall_hook")
  if [ "$HOOK" -gt 0 ]; then
    ok "register_uninstall_hook() used (alternative to uninstall.php)"
    ((PASS++))
  else
    warn "No uninstall cleanup found (no uninstall.php, no register_uninstall_hook)"
    info "WP.org guideline: plugins storing data must clean up on deletion"
    info "Create uninstall.php with: delete_option, DROP TABLE, delete_user_meta"
    ((WARN++))
  fi
fi

# ── 8. CCPA / US Privacy Compliance Signals ───────────────────────────────────
echo ""
echo -e "${BOLD}  8/8 CCPA / US State Privacy${NC}"

CCPA_SIGNALS=$(grep_plugin "do_not_sell\|dns_gpc\|global.*privacy.*control\|GPC\|ccpa\|california.*privacy")
if [ "$CCPA_SIGNALS" -gt 0 ]; then
  ok "CCPA/GPC signals handled ($CCPA_SIGNALS files)"
  ((PASS++))
else
  warn "No CCPA / Global Privacy Control (GPC) signal handling detected"
  info "If plugin serves US users: check Sec-GPC header and honor 'Do Not Sell' signals"
  info "Reference: https://globalprivacycontrol.org/"
  ((WARN++))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  GDPR Full Check: ${GREEN}$PASS passed${NC} · ${YELLOW}$WARN warnings${NC} · ${RED}$FAIL failed${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}  GDPR Full Check: FAILED — required hooks missing${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}  GDPR Full Check: WARNINGS — review before release${NC}"
  exit 2
else
  echo -e "${GREEN}  GDPR Full Check: PASSED${NC}"
  exit 0
fi
