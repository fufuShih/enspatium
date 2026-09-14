# Upgrade

Use a maintenance window. Commands below run from the source checkout; keep the current environment file, release and verified backup.

## Prepare

1. Copy `deploy/.env` to `deploy/.env.next`. Change only `ENSPATIUM_IMAGE_TAG` for a normal release update; preserve the database password and session key.
2. Review the release's migrations and Compose changes. Keep the current PostgreSQL image for an application-only upgrade.
3. Pull the new application images:

```sh
docker compose --env-file deploy/.env.next -p enspatium pull server web
```

From the currently deployed checkout, [create and verify a backup](BACKUP.md) before adopting the new Compose configuration. Use a new backup directory. Backup resumes the service afterward; keep the final backup and upgrade close together.

## Apply

Stop the old web/backend using the current deployment configuration:

```sh
docker compose --env-file deploy/.env -p enspatium stop --timeout 660 web server
```

Confirm a clean backend exit without OOM or forced termination. Then start the new release from its checkout:

```sh
docker compose --env-file deploy/.env.next -p enspatium up -d --no-build --pull never --wait
```

Migrations must finish before the backend starts. Verify HTTPS, sign-in, private Git clone/push, current/older Object downloads and the administrator's storage integrity check.

After acceptance, use the new environment for future commands. Keep the old environment and backup separately. Never delete the data volumes during an upgrade.

## If it fails

Keep traffic stopped. A failed migration may already have changed the database; switching only the image back is insufficient.

[Restore the pre-upgrade backup](BACKUP.md) and saved images into a fresh project on separate ports. Verify it before switching traffic, and retain the failed deployment's volumes for any newer data. Do not merge the two installations automatically.

## Local persistence test

With dependencies installed, Docker running in Linux mode and Git available, build the candidate images:

```sh
docker build --target server -t enspatium-server:persistence-check .
docker build --target web -t enspatium-web:persistence-check .
```

PowerShell example (change the previous image pair to the release you are upgrading from; all images must already be available locally, including `postgres:17-bookworm`):

```powershell
$env:UPGRADE_TEST = "true"
$env:UPGRADE_FROM_SERVER_IMAGE = "felixshih/enspatium-server:v0.2.0"
$env:UPGRADE_FROM_WEB_IMAGE = "felixshih/enspatium-web:v0.2.0"
$env:UPGRADE_TO_SERVER_IMAGE = "enspatium-server:persistence-check"
$env:UPGRADE_TO_WEB_IMAGE = "enspatium-web:persistence-check"
pnpm --filter @enspatium/server test:upgrade
```

The test generates temporary secrets and uses isolated projects, random localhost ports and its own volumes. It checks restart, container recreation, image upgrade and recovery after a failed migration, then removes its test data. Accounts, tokens, Git commits/tags, Object versions, deleted files and retention settings must survive. No deployment `.env` is needed. This does not verify power-loss recovery or a PostgreSQL major-version upgrade.
