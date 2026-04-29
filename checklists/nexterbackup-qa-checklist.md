# NexterBackup v1.0.0 — Human QA Checklist
> Walk through this on a real host with real data before tagging the release. Everything here has been exercised by the automated suite, but a separate set of eyes on a live install is required for sign-off. Budget ~20 minutes for the smoke walkthrough plus extra time if you run the edge-case probes.

---

## Install

- [ ] Download `nexter-extension-NexterBackup-v1.zip` from the release asset
- [ ] WP Admin → Plugins → Add New → Upload Plugin → choose the zip → Install
- [ ] Activate "Nexter Extension"
- [ ] `Backup` appears in the admin sidebar alongside the other Nexter modules
- [ ] If `zip` or `openssl` PHP extension is missing, a clear admin notice is shown (only file a bug if the notice is missing or wrong)

## A. Dashboard

- [ ] Loads in under 3 seconds on a 2,000-post site
- [ ] Stat tiles render: Total backups, Total size, Disk space, Success rate
- [ ] Empty-state card shows "Pick a destination" and "Set a schedule" CTAs when site has no backups
- [ ] No console errors in DevTools

## B. Run a backup

- [ ] Click `Run backup now` → button disables, "Backup in progress" card appears
- [ ] Live progress bar advances (percent updates every ~2s)
- [ ] On completion the run moves into "Recent activity" with status `success`
- [ ] An archive `.zip` appears under `wp-content/uploads/nexter-backups/`

## C. Selective restore (component-split layout)

- [ ] Each backup writes 4–7 zips: `-uploads.zip`, `-plugins.zip`, `-themes.zip`, `-mu_plugins.zip`, `-wpcore.zip`, `-others.zip`, `-db.zip`
- [ ] Open Backups → click `Restore` → wizard appears
- [ ] Wizard shows per-component checkboxes; default is "all checked"
- [ ] Untick `Plugins` + `Themes`, tick only `Database` → confirm
- [ ] Restore completes; only DB was touched (plugins/themes folders unchanged)

## D. Encryption round-trip

- [ ] Settings → Encryption → set passphrase, save
- [ ] Run backup; new archive parts end in `.enc`
- [ ] Restore latest with the right passphrase → succeeds
- [ ] Restore with wrong passphrase → friendly error, NO partial data written

## E. Cloud destination (Google Drive / Dropbox / OneDrive — pick one)

- [ ] Settings → Storage → click `Connect`
- [ ] OAuth round-trip lands you back on the destination page with green status
- [ ] Run backup with that destination ticked; archive uploads
- [ ] Disconnect from the cloud provider's side (revoke our app token); on next `/backup/stats` poll the Dashboard shows a red "Reconnect" alert

## F. Schedule

- [ ] Schedule → set Files: every 6 hours, Database: every 3 days
- [ ] Save → next-run timestamps appear under the field
- [ ] Settings persist across page reload
- [ ] Wait for the schedule to fire (or trigger manually via wp-cli) → archive shows up automatically

## G. Logs

- [ ] Logs page lists every run with timestamp, type, status
- [ ] Click into one → entries are timestamped, level-coded (info/warn/error), no raw stack traces leaked

## H. Permissions

- [ ] Create a non-admin user (Editor)
- [ ] Log in as that user → confirm `Backup` menu does NOT appear in admin
- [ ] Hit `/wp-json/nxt-backup/v1/backup/stats` directly → 403

## I. Site Health

- [ ] Tools → Site Health → status tab
- [ ] NexterBackup tests visible: destination, schedule, last run, storage, extensions, wp-cron, write probe
- [ ] All green on a healthy install

## J. Audit log

- [ ] Tools → Audit log → see every recent destructive action (`backup.run`, `backup.restore`, `destination.save`, `destination.delete`, `reauth.failed` if applicable)
- [ ] No secrets visible in the context column

---

## Edge-case probes (worth doing if you have a spare host)

- [ ] **Big DB**: import a 1M-row dummy table, run a database backup. Should complete in many ticks across ~3–10 minutes; memory should NOT spike above 96 MB
- [ ] **DISABLE_WP_CRON**: add `define('DISABLE_WP_CRON', true);` to `wp-config.php`. Dashboard shows a yellow alert AND the live progress poller drives `/run/step` itself, so backups still complete without external cron
- [ ] **Storage perm change mid-run**: `chmod 555` the `nexter-backups` directory while a backup is running. Backup fails with a clear "permission denied" log entry (not a silent 0-byte archive)
- [ ] **Wordfence**: install Wordfence with default rules, run a backup. Backup file path may need a one-time exclusion in their "File Change Detection" — by design (Wordfence flags every new large file)
- [ ] **WP Rocket / LiteSpeed Cache**: confirm `/run/current` is NEVER cached — DevTools Network tab shows `Cache-Control: no-store` on every response

---

## Known limitations to communicate to support

These are documented and intentional in v1.0.0 — do not file as bugs:

1. **No PclZip fallback** — without PHP `zip` extension the plugin refuses to load with a clear admin notice. Direct customers to https://www.php.net/manual/en/zip.installation.php or their host's support
2. **No multisite per-site scoping** — on a multisite network the plugin treats the whole network as one site. Per-site backups planned for v1.1
3. **OAuth token refresh requires user click** — when Google Drive / OneDrive / Dropbox tokens expire (every 6 months for Google), the user must click `Reconnect` once. We don't auto-renew (matches UpdraftPlus behaviour)
4. **Cross-host migration search-replace must be configured manually** under Restore → "Search-replace pairs". The DB migration UI doesn't auto-detect the destination domain

## Where to file issues

- **Reproducible bug** → GitHub issues with: WP version, PHP version, active theme, active plugins, what you did, what happened, what you expected, server type (Apache / nginx / LiteSpeed), hosting provider if known
- **Visual / UX defect** → screenshot + admin URL fragment (`#/...`) where you saw it
- **Performance complaint** → paste `phpinfo()` summary + `wp config get` output if possible

---

## Pre-release sign-off

Before v1.0.0 ships, the QA reviewer must tick all of:

- [ ] Smoke walkthrough A–J passed on a clean WordPress install
- [ ] Encrypted backup round-trip (D) passed with correct + wrong passphrase
- [ ] At least one cloud destination (E) round-trip passed
- [ ] No console errors observed during a 30-minute interactive session
- [ ] No PHP errors in `wp-content/debug.log` from our namespace
- [ ] Site Health (I) all green on a healthy install
- [ ] Permissions probe (H) returns 403 to non-admins

**Sign-off**: If all of the above passes, ship it.
