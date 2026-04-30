# NexterBackup v1.0.0 — QA Test Plan ↔ Code Map

> For each QA test case, the file/method/REST endpoint that implements it.
> Use this when writing Playwright specs — go straight to the right code path
> instead of grepping. All routes live under namespace **`nxt-backup/v1`** and
> are gated by `Nxt_Backup_Utils::permission_check()` (which calls `user_can()`
> → admin role + `manage_options` capability).
>
> The React app reads its base URL + nonce from the localized
> `nxtSiteBackupConfig` global injected by `Nxt_Backup_Admin::enqueue_assets()`
> (`php/class-admin.php` line 64).

---

## REST route map

All routes prefixed with `/wp-json/nxt-backup/v1`. Permission column: `perm` =
`Nxt_Backup_Utils::permission_check`; `__return_true` = HMAC-signed (no WP cap).

| Route | Method | Callback (class :: method) | permission_callback |
|---|---|---|---|
| `/backup/settings` | GET | `Nxt_Backup_Rest_Controller :: get_settings` | perm |
| `/backup/settings` | PUT | `Nxt_Backup_Rest_Controller :: put_settings` | perm |
| `/backup/settings/export` | GET | `Nxt_Backup_Rest_Controller :: export_settings` | perm |
| `/backup/settings/import` | POST | `Nxt_Backup_Rest_Controller :: import_settings` | perm |
| `/backup/list` | GET | `Nxt_Backup_Rest_Controller :: list_backups` | perm |
| `/backup/stats` | GET | `Nxt_Backup_Rest_Controller :: get_stats` | perm |
| `/backup/run` | POST | `Nxt_Backup_Rest_Controller :: run_backup` → `Nxt_Backup_Runner::start` | perm |
| `/backup/restore/{id}` | POST | `Nxt_Backup_Rest_Controller :: restore` | perm + reauth gate |
| `/backup/{id}` | DELETE | `Nxt_Backup_Rest_Controller :: delete_backup` | perm + reauth gate |
| `/backup/upload` | POST | `Nxt_Backup_Rest_Controller :: upload_backup` | perm |
| `/backup/rescan` | POST | `Nxt_Backup_Rest_Controller :: rescan` | perm |
| `/backup/log/{id}` | GET | `Nxt_Backup_Rest_Controller :: get_log` | perm |
| `/backup/log/clear` | POST | `Nxt_Backup_Rest_Controller :: clear_logs` | perm |
| `/backup/run/current` | GET | `Nxt_Backup_Rest_Controller :: current_run` | perm |
| `/backup/run/step` | POST | `Nxt_Backup_Rest_Controller :: run_step` → `Nxt_Backup_Runner::step` | perm |
| `/backup/restore/run/current` | GET | `Nxt_Backup_Rest_Controller :: current_restore` | perm |
| `/backup/restore/run/step` | POST | `Nxt_Backup_Rest_Controller :: restore_step` | perm |
| `/backup/download/{id}/{idx?}` | GET | `Nxt_Backup_Rest_Controller :: download_backup` | perm |
| `/backup/destinations` | GET | `Nxt_Backup_Rest_Controller :: list_destinations` | perm |
| `/backup/destinations` | PUT | `Nxt_Backup_Rest_Controller :: save_destination` | perm |
| `/backup/destinations/{id}` | DELETE | `Nxt_Backup_Rest_Controller :: delete_destination` | perm + reauth gate |
| `/backup/destinations/test/{id}` | POST | `Nxt_Backup_Rest_Controller :: test_destination` | perm |
| `/backup/destinations/{type}/oauth/start` | POST | `Nxt_Backup_Rest_Controller :: oauth_start` | perm (+ rate-limit 20/600s) |
| `/backup/destinations/{type}/oauth/callback` | GET, POST | `Nxt_Backup_Rest_Controller :: oauth_callback` | perm |
| `/backup/migration/export` | POST | `Nxt_Backup_Rest_Controller :: migration_export` | perm |
| `/backup/migration/import` | POST | `Nxt_Backup_Rest_Controller :: migration_import` | perm |
| `/backup/search-replace` | POST | `Nxt_Backup_Rest_Controller :: search_replace` | perm |
| `/backup/clone` | POST | `Nxt_Backup_Rest_Controller :: clone_start` | perm |
| `/backup/clone/{id}` | GET | `Nxt_Backup_Rest_Controller :: clone_status` | perm |
| `/backup/anonymise` | POST | `Nxt_Backup_Rest_Controller :: anonymise` | perm |
| `/backup/importer` | POST | `Nxt_Backup_Rest_Controller :: importer_run` | perm |
| `/backup/importer/upload` | POST | `Nxt_Backup_Rest_Controller :: importer_upload` | perm |
| `/backup/site-info` | GET | `Nxt_Backup_Rest_Controller :: site_info` | perm |
| `/backup/site-size` | GET | `Nxt_Backup_Rest_Controller :: site_size` | perm |
| `/backup/db-tables` | GET | `Nxt_Backup_Rest_Controller :: db_tables` | perm |
| `/backup/cron` | GET | `Nxt_Backup_Rest_Controller :: cron_events` | perm |
| `/backup/cron/run` | POST | `Nxt_Backup_Rest_Controller :: cron_run` | perm |
| `/backup/wipe` | POST | `Nxt_Backup_Rest_Controller :: wipe` | perm + reauth gate |
| `/backup/audit` | GET | `Nxt_Backup_Rest_Controller :: audit_recent` | perm |
| `/backup/audit/clear` | POST | `Nxt_Backup_Rest_Controller :: audit_clear` | perm |
| `/backup/lock-admin/set` | POST | `Nxt_Backup_Rest_Controller :: lock_set` | perm |
| `/backup/lock-admin/verify` | POST | `Nxt_Backup_Rest_Controller :: lock_verify` | perm |
| `/backup/lock-admin/clear` | POST | `Nxt_Backup_Rest_Controller :: lock_clear` | perm |
| `/backup/cleanup/summary` | GET | `Nxt_Backup_Rest_Controller :: cleanup_summary` | perm |
| `/backup/cleanup/run` | POST | `Nxt_Backup_Rest_Controller :: cleanup_run` | perm |
| `/backup/cleanup/orphans` | POST | `Nxt_Backup_Rest_Controller :: cleanup_orphans` | perm |
| `/backup/cleanup/temp` | POST | `Nxt_Backup_Rest_Controller :: cleanup_temp` | perm |
| `/backup/paired` | GET | `Nxt_Backup_Rest_Controller :: list_paired` | perm |
| `/backup/paired` | PUT | `Nxt_Backup_Rest_Controller :: pair_site` | perm |
| `/backup/paired/{id}` | DELETE | `Nxt_Backup_Rest_Controller :: unpair_site` | perm + reauth gate |
| `/backup/paired/code` | POST | `Nxt_Backup_Rest_Controller :: pair_code` | perm |
| `/backup/pair/accept` | POST | `Nxt_Backup_Rest_Controller :: pair_accept` | `__return_true` (one-time code + rate-limit) |
| `/backup/list-paired` | POST | `Nxt_Backup_Transfer :: rest_list_paired` | `__return_true` (HMAC) |
| `/backup/fetch` | POST | `Nxt_Backup_Transfer :: rest_fetch` | `__return_true` (HMAC) |
| `/backup/incoming` | POST | `Nxt_Backup_Transfer :: rest_incoming` | `__return_true` (HMAC) |
| `/backup/notify` | POST | `Nxt_Backup_Transfer :: rest_notify` | `__return_true` (HMAC) |
| `/backup/transfer` | POST | `Nxt_Backup_Rest_Controller :: transfer_now` → `Nxt_Backup_Transfer::push` | perm |
| `/backup/pull` | POST | `Nxt_Backup_Rest_Controller :: pull_now` → `Nxt_Backup_Transfer::pull_latest` | perm |
| `/backup/sync/jobs` | GET, PUT | `Nxt_Backup_Rest_Controller :: sync_jobs / save_sync_job` | perm |
| `/backup/sync/jobs/{id}` | DELETE | `Nxt_Backup_Rest_Controller :: delete_sync_job` | perm + reauth gate |

Every response in the namespace gets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private` via `Nxt_Backup_Rest_Controller::add_no_store_headers()` (line 846) — this is critical for TC118.

---

## P0 — Must pass

### TC001 — Plugin install + activate
- **Implementation**: `php/class-loader.php :: __construct()` (loader bootstraps); `Nxt_Backup_Loader :: on_activate()` (line 152); menu via `php/class-admin.php :: register_menu()` (slug `nxt-backup`, cap `manage_options`).
- **REST**: n/a
- **Playwright hint**: Activate plugin via WP-CLI; assert `#adminmenu a[href$="page=nxt-backup"]` is visible; visit `/wp-admin/admin.php?page=nxt-backup` and assert `#nexter-site-backup` root exists with no `.notice-error` PHP warnings.
- **Gotchas**: Sentinel constant `NXT_BACKUP_LOADED` prevents double-load. Activation purges any orphan `nxt_backup_current_run`/`nxt_backup_run_lock` from a previous install.

### TC002 — Open Dashboard
- **Implementation**: `php/class-admin.php :: render_page()` (the React mount point); REST stats endpoint `Nxt_Backup_Tools :: stats()` (`class-tools.php` line 180).
- **REST**: `GET /backup/stats`, `GET /backup/list`, `GET /backup/site-info`
- **Playwright hint**: Navigate to dashboard; wait for `[data-nxt-stats]` (or whatever the React build renders); assert load < 3s; assert no `console.error` events; intercept `/wp-json/nxt-backup/v1/backup/stats` returning 200 with `{data:{total_size, total, success}}`.
- **Gotchas**: React bundle has no source maps — assert via REST + DOM, not via component selectors.

### TC003 — Run a manual full backup
- **Implementation**: `php/class-backup-runner.php :: enqueue()` (line 45) → `start()` alias → `step()` (line 122). Stages dispatched in `dispatch_stage()` (line 231).
- **REST**: `POST /backup/run` returns `{data: {id, status:"queued", ...}}`; poll `GET /backup/run/current` until `status === "success"`.
- **DB rows**: `nxt_backup_current_run` (option), `nxt_backup_archives` (final), `nxt_backup_enqueue_lock` (option), `nxt_backup_run_lock` (transient).
- **Playwright hint**: `POST /backup/run` with `{type:"full"}`; poll `/backup/run/current` every 2s until status terminal; then `GET /backup/list` and assert top entry has `status:"success"` and at least one `parts[]` path resolves to a `.zip` under `wp-content/uploads/nexter-backups/`.
- **Gotchas**: Runner is async — must poll. WP-Cron must fire OR call `POST /backup/run/step` directly to drive ticks.

### TC004 — Component-split layout
- **Implementation**: `class-backup-runner.php :: step_preparing()` (line 258) — branches on `split_archives_by_component` setting; emits one `<base>-<component>.zip` per included component. DB always lands in `<base>-db.zip` when split. See lines 280–337.
- **REST**: `PUT /backup/settings` body `{split_archives_by_component:true}`; then `POST /backup/run` with full components.
- **Playwright hint**: Set the setting; run; after completion read `/backup/list` and assert latest entry's `parts[]` length ≥ 4 and basenames match `/-uploads\.zip$/`, `/-plugins\.zip$/`, `/-themes\.zip$/`, `/-db\.zip$/`.
- **Gotchas**: `mu_plugins`/`others`/`wpcore` add to count if ticked.

### TC005 — Selective restore: tick only Database
- **Implementation**: `class-restore-runner.php :: enqueue()` (line 43) — `components` payload filters which subdirs get restored; `stage_apply_files()` (line 375) skips `db`; `stage_apply_db()` (line 396) only fires when `'db'` is in components. Manifest is added to first zip in `step_archive_files()` line 408.
- **REST**: `POST /backup/restore/{id}` with `{components:["db"], confirm_password:"<wpadminpw>"}`.
- **Playwright hint**: Touch a file under `wp-content/plugins/` BEFORE restore (e.g. `mtime`); call restore with `components:["db"]`; assert plugin file mtime unchanged AND a known DB row was restored.
- **Gotchas**: Must include `confirm_password` (re-auth gate). The runner is async — poll `/backup/restore/run/current` until terminal.

### TC006 — Encryption round-trip
- **Implementation**: `php/class-encryption.php :: encrypt_file()` (line 49) / `decrypt_file()` (line 112). PBKDF2-SHA256 4000 rounds; AES-256-CBC; magic header `NXTBKP\x01`. Backup runner hook: `step_encrypt()` line 572. Restore decrypt: `stage_decrypt()` line 258.
- **REST**: Set passphrase via `PUT /backup/settings` `{encryption_phrase:"…"}`; `POST /backup/run` with `{encrypt:true}`; later `POST /backup/restore/{id}` with `{passphrase:"…", confirm_password:"…"}`.
- **Playwright hint**: Run encrypted backup; assert `parts[0]` ends in `.enc`; restore with same passphrase; assert `status:"success"`.
- **Gotchas**: Settings store encrypts the phrase via `Nxt_Backup_Utils::obfuscate()` (line 185). `Nxt_Backup_Settings::decrypted_passphrase()` reads it back during runs.

### TC007 — Encryption: wrong passphrase
- **Implementation**: `class-encryption.php :: decrypt_file()` line 158 returns `WP_Error('nxt_backup_decrypt_failed', 'Wrong passphrase or corrupted archive.')`. `stage_decrypt()` propagates as `run.error`. Partial output is `@unlink`ed (line 161).
- **REST**: `POST /backup/restore/{id}` with bogus `passphrase`.
- **Playwright hint**: Poll `/backup/restore/run/current`; assert eventual `{status:"failed", error:/Wrong passphrase/}`; verify no files were applied to `wp-content/`.
- **Gotchas**: Passphrase must be supplied in the request even if site has one stored — payload override beats settings (line 270).

### TC008 — Permissions: non-admin
- **Implementation**: `php/class-utils.php :: user_can()` (line 35) — admins always pass; other roles need `manage_options` AND must be in `nxt_backup_allowed_roles` option. `permission_check()` (line 85) returns `nxt_backup_forbidden` 403. Menu is registered with `Nxt_Backup_Utils::capability()` so Editor never sees it (`class-admin.php` line 22).
- **REST**: `GET /backup/stats` should return 403.
- **Playwright hint**: Log in as Editor; assert `#adminmenu` has no `nxt-backup` link; fetch `/wp-json/nxt-backup/v1/backup/stats` with the editor's nonce — assert HTTP 403 and `code:"nxt_backup_forbidden"`.
- **Gotchas**: Filter `nxt_backup_capability` can override; default is `manage_options`.

### TC009 — Site Health all green
- **Implementation**: `php/class-site-health.php :: register_tests()` (line 25). The 7 tests:
  1. `nxt_backup_destination` — `test_destination()`
  2. `nxt_backup_schedule` — `test_schedule()`
  3. `nxt_backup_last_run` — `test_last_run()`
  4. `nxt_backup_storage_dir` — `test_storage()`
  5. `nxt_backup_extensions` — `test_extensions()`
  6. `nxt_backup_wp_cron` — `test_wp_cron()`
  7. `nxt_backup_storage_probe` — `test_storage_probe()`
- **REST**: WP core `GET /wp-json/wp-site-health/v1/tests/{id}` (one per test).
- **Playwright hint**: Pre-seed: enable a non-local destination, set a schedule, run a successful backup. Visit Tools → Site Health; assert each label appears with green badge ("Backups").
- **Gotchas**: Without a remote destination `test_destination` is "recommended" (orange), not green — must add e.g. an SFTP dummy. `test_wp_cron` flips orange if `DISABLE_WP_CRON` is set.

### TC010 — Delete a backup
- **Implementation**: `class-rest-controller.php :: delete_backup()` (line 345). Re-auth gate; removes parts via `@unlink` after path-confining under storage dir; also calls destination `delete()` unless `keep_remote=true`.
- **REST**: `DELETE /backup/{id}` body `{confirm_password:"…"}`.
- **Playwright hint**: Capture top entry id from `/backup/list`; record its `parts[0]` filesystem path; DELETE with valid password; assert `/backup/list` no longer contains id AND `fs.exists(parts[0]) === false`.
- **Gotchas**: Path-confine guard at lines 365–371 — if part lives outside storage dir it's silently skipped. Re-auth required.

---

## P1 — High priority

### TC101 — Connect Google Drive (OAuth)
- **Implementation**: `php/destinations/class-google-drive.php :: oauth_start()` (line 29) returns `{authorize_url, state}`; `oauth_callback()` (line 67) trades code → tokens, persists destination row.
- **REST**: `POST /backup/destinations/google-drive/oauth/start`; redirect; Google sends user back to `GET /backup/destinations/google-drive/oauth/callback?code=…&state=…`.
- **Options touched**: `nxt_backup_oauth_state` (CSRF), `nxt_backup_destinations`.
- **Playwright hint**: Stub Google OAuth in test mode (or use a test Google account); after callback assert `GET /backup/destinations` returns a row with `type:"google-drive"` and `enabled:true`; then `POST /backup/destinations/test/{id}` returns 200.
- **Gotchas**: Real OAuth needs developer credentials. Rate-limited at `oauth-start` 20/600s (`class-rest-controller.php` line 507). Pretty-redirect to `admin.php?page=nxt-backup#/storage/google-drive` (line 535).

### TC102 — Connect Dropbox
- **Implementation**: `php/destinations/class-dropbox.php :: oauth_start()` (line 25) / `oauth_callback()` (line 53).
- **REST**: `POST /backup/destinations/dropbox/oauth/start` → redirect → `…/oauth/callback`.
- **Playwright hint**: Same as TC101 with type `dropbox`.
- **Gotchas**: Requires Dropbox app key/secret in env or settings.

### TC103 — Connect OneDrive
- **Implementation**: `php/destinations/class-onedrive.php :: oauth_start()` (line 25) / `oauth_callback()` (line 60).
- **REST**: `POST /backup/destinations/onedrive/oauth/start`.
- **Playwright hint**: Same as TC101 with type `onedrive`.

### TC104 — Connect Amazon S3
- **Implementation**: `php/destinations/class-amazon-s3.php :: test()` (line 38). Saved via `PUT /backup/destinations`.
- **REST**: `PUT /backup/destinations` body `{type:"amazon-s3", config:{access_key, secret_key, bucket, region}, enabled:true}`; then `POST /backup/destinations/test/{id}`.
- **Playwright hint**: Use MinIO container or AWS test bucket; expect `{ok:true, message:"…"}`.
- **Gotchas**: Secrets are obfuscated at rest via `Nxt_Backup_Utils::obfuscate()` — `list_safe()` strips them.

### TC105 — Connect SFTP
- **Implementation**: `php/destinations/class-sftp.php :: test()` (line 21). Uses ssh2 or phpseclib.
- **REST**: `PUT /backup/destinations` body `{type:"sftp", config:{host, port, user, key_or_password, path}}`; then `POST /backup/destinations/test/{id}`.
- **Playwright hint**: Spin up `atmoz/sftp` container; save dest; call test; assert success.
- **Gotchas**: Needs PHP ssh2 ext OR phpseclib; if neither present test returns explicit error.

### TC106 — Run backup with cloud destination ticked
- **Implementation**: `class-backup-runner.php :: step_upload()` (line 612) iterates `(destination × part)` with one upload per tick.
- **REST**: `POST /backup/run` with `{destinations:["<id>"]}`.
- **Playwright hint**: Trigger run; poll until success; inspect `/backup/list` top entry's `remote[]` array; verify object exists at provider (S3 head-object, Drive files.get).
- **Gotchas**: `delete_local_after_remote` setting (default true) removes local zip after remote upload (`step_cleanup()` line 667) — verify against the cloud copy, not local disk.

### TC107 — Disconnect cloud (revoke from provider)
- **Implementation**: Each destination's `test()` method returns `WP_Error` when token is no longer valid; failures surface in `Nxt_Backup_Destinations :: test()` (`class-destinations.php` line 144). The "Reconnect" pill in UI is driven by polling `/backup/destinations` + a periodic test. Note: there is no dedicated background "alert within 1 min" job — **NOT FOUND** as a scheduled cron. The UI most likely polls `/backup/destinations/test/{id}` periodically.
- **REST**: `POST /backup/destinations/test/{id}` returns `WP_Error` after external revoke.
- **Playwright hint**: Revoke OAuth at provider; trigger UI test; assert "Reconnect" CTA shows. **Possible gap** — if the spec demands "within 1 min" automated alert, confirm whether there's a JS poll loop in the React bundle.
- **Gotchas**: No server-side cron health-check exists — rely on UI polling.

### TC108 — Reconnect after revoke
- **Implementation**: Same OAuth start/callback as TC101–103.
- **REST**: `POST /backup/destinations/{type}/oauth/start` again.
- **Playwright hint**: After successful re-OAuth, `POST /backup/destinations/test/{id}` returns 200; UI alert disappears.

### TC109 — Schedule: every 6 hours
- **Implementation**: `php/class-scheduler.php :: sync_events()` (line 91); `frequency_to_interval()` line 44 maps `every-6-hours` → `nxt_backup_6hours` cron interval; `next_timestamp_for()` line 240 computes next run timestamp.
- **REST**: `PUT /backup/settings` body `{schedule_files_interval:"every-6-hours", schedule_files_starttime:"02:00"}`.
- **Playwright hint**: Persist setting; reload page; assert UI shows next-run time. Verify via `GET /backup/cron` that an event for `nxt_backup_cron_run` with arg `files` exists ~6h out.
- **Gotchas**: `Nxt_Backup_Scheduler::sync_events()` is called from `Nxt_Backup_Loader::on_init` — settings save flow re-syncs.

### TC110 — Schedule fires automatically
- **Implementation**: `class-scheduler.php :: on_cron_dispatch()` (line 151) — registered on hook `nxt_backup_cron_run` (`class-loader.php` line 126) — calls `Nxt_Backup_Runner::start()`.
- **REST**: `POST /backup/cron/run` with `{hook:"nxt_backup_cron_run"}` to force fire.
- **Playwright hint**: Force-fire the cron hook; poll `/backup/run/current`; assert backup id starts and completes.
- **Gotchas**: `wp cron event run nxt_backup_cron_run` from CLI is the cleanest trigger.

### TC111 — Pair two sites (one-time pair codes)
- **Implementation**: `php/class-paired-sites.php :: generate_pair_code()` (line 63, TTL 1800s); `pair_with()` (line 95) on originator; `accept_pair()` (line 147) on receiver.
- **REST**: Receiver `POST /backup/paired/code` → returns `{code, expires_in}`. Originator `PUT /backup/paired` body `{url, code, label}`. Cross-site call lands on `POST /backup/pair/accept` (public, rate-limited 10/900s per IP, 5/300s per code-hash bucket — `class-rest-controller.php` lines 750–762).
- **Options touched**: `nxt_backup_pair_codes`, `nxt_backup_paired_sites`.
- **Playwright hint**: Bring up two WP installs; on site B fetch pair code; on site A PUT paired with B's URL+code; assert both `GET /backup/paired` lists show role `origin` / `receiver` and `secret_set:true`.
- **Gotchas**: Receiver URL is SSRF-checked via `Nxt_Backup_Utils::safe_remote_url()`; loopback/RFC1918 rejected — testing locally requires public hostnames or a `nxt_backup_client_ip`-style filter override.

### TC112 — Push backup to paired site
- **Implementation**: `php/class-transfer.php :: push()` (line 27) → multipart POST to receiver's `/backup/incoming` (HMAC-signed). Receiver: `Nxt_Backup_Transfer :: rest_incoming()` (line 189) + `rest_notify()` (line 210).
- **REST**: `POST /backup/transfer` body `{backup_id, pair_id}`.
- **Playwright hint**: Run a backup on A; trigger transfer; on B `GET /backup/list` shows entry with `label:"Received from <A>"`.
- **Gotchas**: SSRF re-check on every push (`ensure_safe_pair_url()` line 299).

### TC113 — Pull latest from paired site
- **Implementation**: `class-transfer.php :: pull_latest()` (line 79).
- **REST**: `POST /backup/pull` body `{pair_id}`.
- **Playwright hint**: Pre-seed B with a backup; on A POST pull; assert A's `/backup/list` gains entry with `label:"Pulled from <B>"`.

### TC114 — Upload archive zip via Importer
- **Implementation**: `php/class-importer.php :: upload_archive()` (line 25) + `run()` (line 41). Component detection by zip member sniffing in `detect_components()` line 73.
- **REST**: `POST /backup/importer/upload` (multipart) → returns `{file_id, path}`; then `POST /backup/importer` body `{file_id}`.
- **Playwright hint**: Upload a known-good NexterBackup zip; run importer; assert `status:"success"` entry appears with `tagged:true`; restore it via `POST /backup/restore/{id}`.
- **Gotchas**: Imported archives go to `nexter-backups/imported/`, chmod 0600.

### TC115 — Restore on different domain with 2 search-replace pairs
- **Implementation**: `class-restore-runner.php :: stage_search_replace()` (line 423) loops payload's `search_replace[]`. `Nxt_Backup_Search_Replace :: run()` does the actual rewrite.
- **REST**: `POST /backup/restore/{id}` body `{components:["db"], search_replace:[{from:"old.example",to:"new.example"},{from:"https://old",to:"https://new"}], confirm_password:"…"}`.
- **Playwright hint**: Restore on a fresh domain; assert `siteurl`/`home` options now contain new host; assert no rows still contain old host string.
- **Gotchas**: Search-replace only fires if `db` is in components (line 426).

### TC116 — Backup on 1GB+ uploads dir
- **Implementation**: Step-runner architecture — `class-backup-runner.php :: step_archive_files()` (line 364) advances by `list_offset` byte-cursor; multiple ticks. `split_archive_mb` setting (`step_archive_files()` line 367) drives `Nxt_Backup_Zip_Writer` part splitting.
- **REST**: `POST /backup/run`; poll `/backup/run/current` watching `percent` advance multiple times.
- **Playwright hint**: Inflate fixture to 1GB+; run; collect `/backup/run/current` snapshots; assert percent monotonically increases over multiple polls (proves multi-tick); final entry has `parts.length > 1` if `split_archive_mb` is set low.
- **Gotchas**: Slow — set generous test timeout. WP-Cron must be hot or call `/backup/run/step` to drive ticks faster.

### TC117 — Multi-part archive (split-archive-mb=50)
- **Implementation**: `class-backup-runner.php` line 367 reads `split_archive_mb`. Restore: `class-restore-runner.php :: stage_extract()` (line 290) iterates over `source_parts[]` so reading multi-part archives works.
- **REST**: `PUT /backup/settings` `{split_archive_mb:50}`; `POST /backup/run`.
- **Playwright hint**: Assert `parts.length > 1` and each file < 60MB; restore and verify success.

### TC118 — Backup over WP Rocket / LiteSpeed (Cache-Control: no-store on /run/current)
- **Implementation**: `class-rest-controller.php :: add_no_store_headers()` (line 846) — registered via `rest_post_dispatch` filter. Adds `Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private` + `Pragma: no-cache` + `Expires: 0` to every response under our namespace.
- **REST**: `GET /backup/run/current`.
- **Playwright hint**: Install WP Rocket (or any page-cache plugin); make `GET /backup/run/current`; inspect response headers — assert `cache-control` contains `no-store`.

### TC119 — Concurrent click protection
- **Implementation**: `class-backup-runner.php :: enqueue()` (line 45) uses two locks: durable `INSERT IGNORE` row via `claim_enqueue_lock()` (line 818) AND object-cache `wp_cache_add()`. Returns `WP_Error('nxt_backup_already_running', status:409)` if already locked (line 92).
- **REST**: Two parallel `POST /backup/run` requests.
- **Playwright hint**: Fire two parallel POSTs; assert exactly one returns 200, the other 409 with `code:"nxt_backup_already_running"`.
- **Gotchas**: Stale locks reclaimed if `last_tick_at` older than 3× `max_runtime_sec` (lines 71–96).

### TC120 — Re-auth gate on Restore
- **Implementation**: `class-rest-controller.php :: require_reauth()` (line 667) — checks `confirm_password` against `wp_check_password`; rate-limit 5/600s per user via `Nxt_Backup_Rate_Limit::check`. Logs `reauth.failed` to audit log.
- **REST**: `POST /backup/restore/{id}` without `confirm_password` → 401 `nxt_backup_reauth_required`.
- **Playwright hint**: Call restore without password → assert 401; with wrong password → 401 `nxt_backup_reauth_invalid`; with correct → 200.
- **Gotchas**: Bypass with `define('NXT_BACKUP_TESTING', true)` — only for unit tests.

### TC121 — Re-auth gate on Wipe
- **Implementation**: `class-rest-controller.php :: wipe()` line 618 — same `require_reauth()` gate; logs `wipe.run`.
- **REST**: `POST /backup/wipe` body `{settings:1, destinations:1, confirm_password:"…"}`.
- **Playwright hint**: Same pattern as TC120.

### TC122 — Re-auth gate on Unpair-site
- **Implementation**: `class-rest-controller.php :: unpair_site()` (line 731) — same gate; logs `pair.unpair`.
- **REST**: `DELETE /backup/paired/{id}` body `{confirm_password:"…"}`.
- **Playwright hint**: Same pattern.

### TC123 — Audit log records every mutating action
- **Implementation**: `php/class-audit-log.php :: record()` (line 27). Recorded actions seen across the codebase:
  - `backup.restore`, `backup.delete` (`class-rest-controller.php` lines 341, 352)
  - `destination.save`, `destination.delete` (lines 486, 499)
  - `oauth.start` (line 518)
  - `wipe.run` (line 631)
  - `lock_admin.clear` (line 652)
  - `pair.accept`, `pair.unpair`, `pair.rate_limited` (lines 740, 751, 760, 767)
  - `sync.delete` (line 836)
  - `reauth.failed`, `reauth.rate_limited` (lines 677, 683)
- **REST**: `GET /backup/audit?limit=100`.
- **Playwright hint**: Perform each mutating action; assert latest `/backup/audit` entries include matching `action` codes with `user`, `ip`, `ua`, `ts` populated.
- **Gotchas**: Capped at 1000 entries (`CAP` const). Secrets scrubbed via `scrub_context()` (line 78) — keys ending `_token`/`_secret` plus an explicit deny-list become `••••`.

---

## P2 — Edge cases

### TC201 — DISABLE_WP_CRON site (UI poller drives /run/step)
- **Implementation**: Synchronous fallback — `class-backup-runner.php :: step()` (line 122) is exposed via `POST /backup/run/step`; React app calls it on a poll loop when wp-cron is unavailable.
- **REST**: `POST /backup/run/step` returns latest `/run/current` snapshot.
- **Playwright hint**: Set `define('DISABLE_WP_CRON', true)` in test wp-config; trigger a backup; assert UI eventually completes (must be polling `/run/step`); assert each step POST returns 200 with mutated `percent`/`stage`.

### TC202 — Wordfence installed alongside
- **Implementation**: No special hook — backup just runs. Wordfence may flag `nexter-backups/` zip as "file change detected" (FCD) on its scanner.
- **REST**: `POST /backup/run`.
- **Playwright hint**: Pre-install Wordfence; run backup; assert `status:"success"`. Document the FCD warning in test notes — not a code change.

### TC203 — iThemes Security file-change scanner
- Same as TC202.

### TC204 — Big database 100k posts (no OOM on 128MB limit)
- **Implementation**: `class-db-dumper.php :: dump_single_table()` (called from `class-backup-runner.php :: step_archive_db()` line 515) — one table per tick; per-row chunking inside the dumper.
- **REST**: `POST /backup/run` with `{type:"database"}`.
- **Playwright hint**: Pre-seed 100k post rows; set `memory_limit=128M`; run; assert success and resulting `database/database.sql` extractable.
- **Gotchas**: Memory profile depends on `class-db-dumper.php`'s chunk size — not surveyed in this map.

### TC205 — Mid-backup PHP fatal (next cron tick resumes from cursor)
- **Implementation**: Resumption insurance in `class-backup-runner.php :: step()` line 172 — schedules a 5-minute single-shot wakeup BEFORE the tick body runs. Lock auto-reclaim if `LOCK_KEY` transient older than `2 * max_runtime + 60` (line 144). Stale enqueue lock reclaim in `enqueue()` lines 71–96.
- **Playwright hint**: Inject a `kill -9` of php-fpm worker mid-tick (or simulate by setting `nxt_backup_run_lock` to `time()-9999`); trigger next cron; assert `/backup/run/current` shows `stage` advancing past where it died (cursor preserved in the run record).

### TC206 — Storage dir perm revoked mid-run
- **Implementation**: Pre-flight probe in `class-backup-runner.php :: step_preparing()` line 263 calls `Nxt_Backup_Fs::probe_storage_writable()`. Mid-run zip-writer errors propagate via `Nxt_Backup_Zip_Writer::open()` (line 400 and 533); failed runs report `error` and never get a 0-byte archive (no record_in_history without `parts`).
- **Playwright hint**: Start backup; `chmod 0500 wp-content/uploads/nexter-backups/`; assert run flips to `failed` with descriptive `error`; assert no `.zip` of size 0.

### TC207 — OAuth token expiry (Reconnect alert)
- **Implementation**: Each destination's `test()` returns WP_Error if token is rejected. No background scheduled re-auth check found. UI shows "Reconnect" based on test result. Same caveat as TC107.
- **REST**: `POST /backup/destinations/test/{id}` after token expiry returns 401-like error.
- **Playwright hint**: Force-expire token (provider sandbox); call test; assert error → assert UI alert.

### TC208 — SSRF probe: paste 169.254.169.254 as paired-site URL
- **Implementation**: `class-utils.php :: safe_remote_url()` (line 280) + `ip_is_blocked()` (line 337). Explicit literal block of `169.254.169.254`, `fd00:ec2::254`, `::ffff:169.254.169.254` (line 343). Plus `FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE` for RFC1918/loopback. Called from `class-paired-sites.php :: pair_with()` line 104 and `accept_pair()` line 161.
- **REST**: `PUT /backup/paired` body `{url:"http://169.254.169.254", code:"…"}`.
- **Playwright hint**: Submit; assert WP_Error `nxt_backup_unsafe_remote_url` with message containing "metadata address". Repeat for `127.0.0.1`, `10.0.0.1`, `gopher://`.
- **Gotchas**: DNS rebinding defeated because we resolve and check ALL A/AAAA records (lines 302–326).

### TC209 — Zip-slip probe: importer zip with `../../wp-config.php`
- **Implementation**: `class-restore-runner.php :: entry_is_unsafe()` (line 508) — rejects entries containing `..`, leading `/`, drive-letter prefixes, NUL bytes. Called from `stage_extract()` line 320 and `copy_recursive()` line 481. Realpath confinement against `extract_real` (line 340).
- **Playwright hint**: Craft a zip whose first entry name is `../../wp-config.php`; upload via importer; restore; assert `wp-config.php` is **unchanged** AND log shows `"Skipped unsafe archive entry: ../../wp-config.php"`.
- **Gotchas**: Symlink entries also skipped via `stat_is_symlink()` (line 519).

### TC210 — Encryption set + openssl disabled → critical alert
- **Implementation**: `class-encryption.php :: available()` line 35 requires `openssl_encrypt`/`openssl_decrypt`/`hash_pbkdf2`. Site Health `test_extensions()` (`class-site-health.php` line 146) flags missing as `critical`/red.
- **REST**: WP Site Health endpoint or visit Tools → Site Health.
- **Playwright hint**: Disable openssl in `disable_functions`; assert `nxt_backup_extensions` test returns `status:"critical"` with `Missing: OpenSSL`.

### TC211 — set_time_limit disabled (Cloudways/Plesk) → can_extend=false, clamp to 80%
- **Implementation**: `class-utils.php :: can_set_time_limit()` (line 130) checks `disable_functions` for `set_time_limit`. `effective_runtime_budget()` (line 107) clamps to `floor(max_execution_time * 0.8)` when extension is unavailable.
- **REST**: n/a (internal helper).
- **Playwright hint**: Set `disable_functions=set_time_limit` and `max_execution_time=30`; trigger backup; assert tick budget effectively ≤ 24s by inspecting `last_tick_at` deltas in `/backup/run/current`.

### TC212 — WP-Cron disabled → yellow warning, manual runs still work
- **Implementation**: `class-site-health.php :: test_wp_cron()` line 164 returns `recommended` (orange) if `DISABLE_WP_CRON` set. Manual runs use `/backup/run/step` poll fallback.
- **Playwright hint**: Set `DISABLE_WP_CRON=true`; assert Site Health shows orange "WP-Cron is disabled"; trigger manual backup via `/run` + drive `/run/step` polling; assert success.

### TC213 — Filename with non-UTF8 bytes
- **Implementation**: `class-fs.php :: walk()` (line 145) enumerates files. Zip writer (`class-zip-writer.php`) ultimately calls `ZipArchive::addFile`. **NOT FOUND** an explicit non-UTF8 sanitizer — behaviour depends on PHP/zip ext. **Possible gap**: verify whether a warning is logged and entry skipped, or whether the encoding is silently mangled.
- **Playwright hint**: Create file with bytes like `0xFF\xFE.txt`; run backup; check `/backup/log/{id}` for warning OR open the zip and inspect entry name.

### TC214 — Symlink in uploads pointing outside wp-content
- **Implementation**: `class-fs.php :: walk()` (line 145) — surveying signature only; need to inspect for `is_link` filtering. Restore-side guard for symlinks-inside-archive exists in `class-restore-runner.php` line 325 (`stat_is_symlink`).  Backup-side symlink filtering not fully verified — **Possible gap** if `walk()` follows symlinks.
- **Playwright hint**: Create `wp-content/uploads/escape -> /etc/hosts`; run backup; extract resulting zip; assert `/etc/hosts` content is NOT inside.

---

## P3 — Polish

### TC301 — Mobile viewport 375x667
- **Implementation**: React build (opaque). No PHP.
- **Playwright hint**: `page.setViewportSize({width:375, height:667})`; navigate; assert sidebar collapses (look for hamburger button); use `page.locator('button').evaluateAll(els => els.every(b => b.offsetWidth >= 44 && b.offsetHeight >= 44))`.

### TC302 — Keyboard navigation
- **Implementation**: React build.
- **Playwright hint**: Tab-walk through Dashboard; assert each focused element has visible outline (`outline-width !== '0px'`).

### TC303 — Screen reader (toggles announced as switch; table headers)
- **Implementation**: React build. Use `axe-playwright` or NVDA log.
- **Playwright hint**: Run axe accessibility scan; assert no violations in `aria-roles` and `table-header-association`.

### TC304 — Reduced motion
- **Implementation**: React build (CSS media query).
- **Playwright hint**: `page.emulateMedia({reducedMotion:'reduce'})`; assert spinner still visible; assert modal `transition-duration:0s`.

### TC305 — i18n switch to fr_FR
- **Implementation**: `Nxt_Backup_Admin :: enqueue_assets()` calls `wp_set_script_translations('nxt-backup-app', 'nexter-extension')` (line 80). All PHP strings wrapped in `__('…','nexter-extension')`.
- **Playwright hint**: Switch user locale to `fr_FR` via WP profile; assert menu label is translated (e.g. menu title key) and at least one REST error message returns French.

### TC306 — Audit log export to CSV
- **Implementation**: `class-audit-log.php :: export_csv()` (line 60). Secrets pre-scrubbed via `scrub_context()` (line 78).
- **REST**: `GET /backup/audit?limit=1000` (then UI-side CSV build) — or check if there's a download endpoint via the Tools page (likely UI generates the CSV from JSON).
- **Playwright hint**: Trigger audit-export from UI; download CSV; assert no row contains anything matching `/secret|token|password|access_key/`.

### TC307 — Settings export/import round-trip
- **Implementation**: `Nxt_Backup_Tools :: export_settings()` (`class-tools.php` line 148) / `import_settings()` (line 158). Strips server-only fields (`encryption_phrase`, lock password set flag).
- **REST**: `GET /backup/settings/export`; `POST /backup/settings/import` body = exported JSON.
- **Playwright hint**: Set non-default settings; export; reset; import; assert `GET /backup/settings` matches the original.

### TC308 — WP-CLI: `wp nexter-backup run`
- **Implementation**: `php/class-wpcli.php` registers root command `nexter-backup` (line 24). Subcommands:
  - `run` — `Nxt_Backup_WPCLI :: run()` (line 40) flags `--type`, `--components`, `--destinations`, `--label`, `--keep-forever`
  - `list` — `list_()` line 73
  - `restore <id>` — line 105
  - `delete <id>` — line 140
  - `search-replace <from> <to>` — line 182
  - `anonymise` — line 204
  - `wipe` — line 224
  - `settings export|import` — line 241
  - `destinations list|test <id>` — line 272
- **Playwright hint**: This is a CLI test, not browser — shell out: `wp nexter-backup run --type=full`; assert exit 0 and "Run … success" message; verify with `wp nexter-backup list`.
- **Gotchas**: Note the command is `nexter-backup` (not `nxt-backup` as the test plan abbreviates). Update Playwright test description accordingly.

---

## Appendix A — Step-runner internals

Backup runner (`php/class-backup-runner.php`):
- **Run record option**: `nxt_backup_current_run` (`RUN_OPTION`).
- **Tick lock transient**: `nxt_backup_run_lock` (`LOCK_KEY`) — reclaimed if older than `2 * max_runtime + 60` seconds.
- **Enqueue lock option**: `nxt_backup_enqueue_lock` (`ENQUEUE_LOCK_KEY`) — atomic via `INSERT IGNORE` (`claim_enqueue_lock()` line 818) PLUS `wp_cache_add` for fast path. Stale-reclaim if older than `3 * max_runtime`.
- **Step hook**: `nxt_backup_run_step` (`STEP_HOOK`).
- **Watchdog**: every tick re-schedules a 5-minute single-shot via `wp_schedule_single_event` (line 174) so a crashed PHP process gets resumed automatically.
- **Stages**: `preparing → archive → database → finalize → encrypt → upload → cleanup → finished`.
- **Cursor lives inside run record**: `run.cursor.archive.{lists, list_index, list_offset, manifest_done}`, `run.cursor.database.{table_index, tables}`, `run.cursor.encrypt.part_index`, `run.cursor.upload.{dest_index, part_index}`.
- **Per-tick budget**: `Nxt_Backup_Utils :: effective_runtime_budget()` (clamps to 80% of `max_execution_time` when `set_time_limit` is in `disable_functions`).
- **Browser kick-off**: `fastcgi_finish_request()` after queue write (`step()` line 185) so the UI gets its 200 immediately.

Restore runner (`php/class-restore-runner.php`):
- **Run record option**: `nxt_backup_current_restore` (`RUN_OPTION`).
- **Lock transient**: `nxt_backup_restore_lock` (`LOCK_KEY`).
- **Step hook**: `nxt_backup_restore_step`.
- **Stages**: `preparing → decrypt → extract → apply_files → apply_db → search_replace → cleanup → finished`.
- **Backwards-compat sync mode**: `Nxt_Backup_Restore_Runner :: run()` (line 110) drives ticks inline (used by WP-CLI + tests).

---

## Appendix B — Helpful test fixtures

A tester preparing this suite needs to fabricate / pre-stage:

1. **Two paired WP installs** with public-resolvable hostnames (TC111–113). Loopback hostnames are rejected by SSRF guard.
2. **Encrypted fixture backup**: a `.zip.enc` file created with a known passphrase using `Nxt_Backup_Encryption::encrypt_file` (TC006/TC007/TC117).
3. **Multi-part archive fixture**: backup with `split_archive_mb=10` against a fixture > 30MB (TC117).
4. **Malicious zip-slip fixture**: a `.zip` with one entry named `../../wp-config.php` (TC209).
5. **Symlink fixture**: a `.zip` whose entries contain a Unix symlink mode in `external_attributes` (TC214) AND a filesystem symlink under uploads pointing outside web root.
6. **Large DB seed**: 100k+ posts via `wp post generate --count=100000` (TC204).
7. **Large uploads dir**: `wp media import` of 1GB+ of binary files (TC116).
8. **OAuth dev credentials** for Google Drive / Dropbox / OneDrive sandbox apps (TC101–103).
9. **MinIO** container or test S3 bucket (TC104, TC106).
10. **Atmoz/sftp** Docker container (TC105).
11. **Test WP user with Editor role** (TC008).
12. **Wordfence + iThemes Security plugin zips** to install for TC202/TC203.
13. **Page-cache plugin** (WP Rocket / LiteSpeed Cache / W3 Total Cache) for TC118.
14. **Custom wp-config.php** with `define('DISABLE_WP_CRON', true)` for TC201/TC212.
15. **Filename with non-UTF8 bytes**: e.g. `printf 'x' > $'\xff\xfe.txt'` for TC213.
16. **`disable_functions=set_time_limit,openssl_encrypt`** PHP ini override for TC210/TC211.
17. **Translation `.mo` file** for `nexter-extension` text-domain in `fr_FR` (TC305) — install with `wp language plugin install nexter-extension fr_FR`.
