# Backup and restore

Run these commands from the source checkout with Node 24 and Docker Compose. Use `deploy/.env` for the deployment being backed up. The deployed release must include `verify-backup.js`.

## Back up

```sh
node deploy/backup.mjs create --env-file deploy/.env --project enspatium --output backups/first
node deploy/backup.mjs verify --env-file deploy/.env --backup backups/first
```

Use a new output directory each time. Backup pauses the web/backend, saves the database, content and exact images, then resumes the service. Verification restores into a temporary isolated project and checks Object bytes and Git repositories before removing that project.

Keep the entire verified backup on another device. It contains private data. Preserve deployment secrets separately; secrets and HTTPS certificates are not included.

## Restore

Prepare `deploy/.env.recovery` with the target hostname/ports, database password and session key. Retaining the original session key preserves existing sessions.

```sh
node deploy/backup.mjs restore --env-file deploy/.env.recovery --backup backups/first --project enspatium-recovery
docker compose --env-file deploy/.env.recovery -p enspatium-recovery -f backups/first/compose.yaml -f backups/first/images.json up -d --no-build --wait
```

Restore requires a new project with no existing containers, networks or volumes. It verifies the backup and leaves the recovered services stopped until the second command.

Use separate ports or a test hostname first. Verify sign-in, private Git clone and current/older Object downloads before switching traffic. Keep the original volumes and continue using the saved Compose and image override files.

## Important

- Stop outside database/content writers; do not edit files, migrate or restart containers during backup.
- Use only complete, verified backups you trust. Recovery returns data to that snapshot; later writes are not included.
- After interruption or unclean shutdown, inspect the service and incomplete backup before restarting. Do not remove lock/helper containers until the original command and Docker work have ended.
- Backups are manual; scheduling, retention and point-in-time recovery are not provided.
