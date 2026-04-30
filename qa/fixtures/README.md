# Test Fixtures

Place the following files here before running the relevant tests.
See **Appendix B** in `checklists/nexterbackup-test-code-map.md` for
full fabrication instructions.

| File | Used by | How to create |
|------|---------|---------------|
| `valid-backup.zip` | TC114 | Run a backup via the plugin and copy one of the generated zips here |
| `zip-slip.zip` | TC209 | `python3 -c "import zipfile; z=zipfile.ZipFile('zip-slip.zip','w'); z.writestr('../../wp-config.php','<?php // HACKED');"` |
| `encrypted-backup.zip.enc` | TC006/007 | Enable encryption in settings, run a backup, copy the `.enc` file here |
