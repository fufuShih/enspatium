# Application upgrades

This is a manual workflow for one backend with the existing PostgreSQL 17 and content volumes. Use a maintenance window and keep the previous release checkout, its private environment file and a verified backup. PostgreSQL major-version upgrades and multi-instance deployments are outside this workflow.

## Prepare before stopping traffic

1. Review the candidate commit and its migrations. In particular, check whether schema/content changes are compatible with the old application. Do not assume changing an image back reverses migrations.
2. In the candidate checkout, copy the deployment environment to `deploy/.env.next` and assign a new, unique `ENSPATIUM_IMAGE_TAG`. Keep the current database password, session key, hostname, ports and data settings unless a change is intentional. Both environment files stay private and uncommitted.
3. Build the candidate images without starting them:

```sh
docker compose --env-file deploy/.env.next -p enspatium -f deploy/compose.yaml build
```

Use a different image tag for every release. Do not overwrite the tag of the currently running release. Review any Compose changes as well as application code; retain the current database image during an application-only upgrade.

From the **currently deployed checkout**, take and verify a backup using the environment file for that deployment:

```sh
node deploy/backup.mjs create --env-file deploy/.env --project enspatium --output backups/before-upgrade
node deploy/backup.mjs verify --env-file deploy/.env --backup backups/before-upgrade
```

Use a fresh backup directory each time. This captures the previous application/database images and data together. Back up before adopting a candidate Compose definition. The backup tool resumes the service afterward: the snapshot is the recovery point, and writes accepted after it will not be in that snapshot. Schedule the final backup and upgrade together during a quiet period.

## Replace the application

Stop the old web and backend, allowing admitted Git uploads/pushes or maintenance jobs to finish. The longer explicit timeout also covers an upload followed by Git processing.

```sh
docker compose --env-file deploy/.env -p enspatium -f deploy/compose.yaml stop --timeout 660 web server
```

Confirm the backend exited cleanly (exit 0, no OOM). If it was forcibly stopped or did not finish normally, keep traffic stopped and investigate before proceeding. Do not use `down --volumes`.

From the candidate checkout, start the built images against the existing project/volumes:

```sh
docker compose --env-file deploy/.env.next -p enspatium -f deploy/compose.yaml up -d --no-build --pull never --wait
```

The migration service must exit successfully before the backend starts; the web service waits for a healthy backend. A failed migration command is a failed upgrade even if PostgreSQL is healthy. Keep traffic stopped and inspect the migration/server logs. Do not bypass dependencies with `--no-deps` or start the old image against a possibly changed schema.

After startup, verify all of the following on the deployed hostname:

- HTTPS and `/api/health/db`, then a nested browser route after reload.
- Sign-in with an existing account and existing-session behavior if the key was retained.
- Clone an existing private Git Space with its existing token; compare HEAD, tags and file contents.
- Push a new commit, then fetch/pull from another clone.
- Download a current and an older Object version; upload a new version and verify its contents.
- Check the administrator System page and run a Storage integrity check.

Record the accepted commit/image tag, the migration result and the verified backup location. Use `deploy/.env.next` as the environment for all subsequent commands for that release, or deliberately replace the current environment file once the release is accepted. Keep the old file separately with its release record.

## If the release fails

Keep the failed deployment stopped. A migration may have committed earlier changes before a later step failed; simply restarting the previous image is not a safe general rollback.

Use the [recovery workflow](BACKUP.md) to restore the **pre-upgrade snapshot and its saved images** into a fresh project with a separate hostname or loopback ports. Verify sign-in, Git HEAD/tags/clone and current/older Object bytes before switching traffic. Retain the failed deployment's volumes: later writes may need deliberate recovery/reconciliation. Do not merge its database or content directory into the restored service automatically.

## Isolated release rehearsal

The Vitest acceptance test uses real old/new images, fresh randomly named Docker projects and loopback ports. It does not upgrade the developer database or `enspatium-smoke` project. It reads connection settings from the ignored `deploy/.env.smoke` file, but every database/content volume belongs to a new test project. The old server must include the backup verifier (release `761d3b8` or later).

Build the previous release in a separate checkout with its own unique server/web image tags, and build the candidate with different tags. With all four images and `postgres:17-bookworm` available locally:

```powershell
$env:UPGRADE_TEST = 'true'
$env:UPGRADE_FROM_SERVER_IMAGE = 'enspatium-server:previous-release'
$env:UPGRADE_FROM_WEB_IMAGE = 'enspatium-web:previous-release'
$env:UPGRADE_TO_SERVER_IMAGE = 'enspatium-server:candidate-release'
$env:UPGRADE_TO_WEB_IMAGE = 'enspatium-web:candidate-release'
pnpm --filter @enspatium/server test:upgrade
```

The test resolves and pins local image IDs and refuses an identical old/new application pair. It creates an account, Git commit/tag and two Object versions on the previous release, verifies a consistent backup, upgrades the same volumes and exercises existing-session/login/token/clone/download and new writes. It then deliberately runs a failing one-shot migration after a test schema change, verifies that backend/web remain stopped, and restores the previous release into another isolated project. Recovery must contain the saved history/versions and no test schema change, while the failed deployment retains its newer Git history and schema. All test projects, volumes and backup artifacts are removed afterward; no deployment-wide image pruning is performed.

This rehearsal proves the selected image pair and migration gate. Run it again for releases with schema or storage changes; a past pass does not establish compatibility for future migrations. It is an application-upgrade test, not a database major-version migration test.

The initial rehearsal passed from `761d3b8` to the application implementation in `ac10eaf`, using distinct server/web image IDs. Those releases share the same production schema; migration replay and the injected post-schema-change failure were tested separately from a real schema-version upgrade.

References: [Compose startup dependencies](https://docs.docker.com/compose/how-tos/startup-order/), [Compose startup and image pull options](https://docs.docker.com/reference/cli/docker/compose/up/).
