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
