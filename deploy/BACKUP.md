# Backup and recovery

This is a manual, single-host recovery workflow for the Compose deployment. It needs Node 24 and Docker with Compose on the operator's computer. Deploy a release containing `verify-backup.js` before taking the first backup. Routine storage inspection remains in the administrator UI/API; recovery runs from the host because the backend is stopped or unavailable.

## Create and verify

From the repository root:

```sh
node deploy/backup.mjs create --env-file deploy/.env --project enspatium --output backups/first
node deploy/backup.mjs verify --env-file deploy/.env --backup backups/first
```

Use a new output directory for every backup. `create` saves the exact running server, web and PostgreSQL images first, then stops web traffic and waits for the backend to exit cleanly. With backend writers stopped, it takes a PostgreSQL custom-format dump and archives the content volume. It restarts the same containers, waits for readiness, and writes a checksum manifest. The database stays running; its data volume is never copied directly. Expect a maintenance window while database/content are copied.

The directory contains `database.dump`, `content.tar.gz`, `images.tar`, the deployment's `compose.yaml`, pinned `images.json`, and `manifest.json`. The manifest is written last. Missing, incomplete or modified artifacts are rejected before restore. Checksums detect damage; they do not authenticate a backup supplied by someone else. Use only your own trusted backup directories.

`verify` loads the saved images into Docker and restores into a randomly named project with new volumes. It starts no web listener. Before applying any new migration, the saved server image checks every Object version's stored bytes/checksum, checks Git integrity, and clones each repository through Git's upload-pack transport into an independent mirror. It compares all refs and HEAD. Success returns counts of checked files, hashes and cloned repositories. Its temporary containers, networks and volumes are removed after success or failure; the source deployment is not modified by verification.

Keep the **whole verified directory** on a separate host or backup device. It includes private repositories, files and account/password hashes; restrict access and protect the copy in transit and at rest. Local backups alone do not survive loss of the host disk. Deploy secrets from `deploy/.env` are deliberately excluded: preserve them separately in a secure location. Caddy's certificates are not included; a recovered deployment obtains certificates for its configured hostname. Image archives support recovery without rebuilding the old release or depending on mutable image tags, on a compatible Docker platform.

## Recover into a new deployment

Prepare `deploy/.env.recovery` with the target hostname/ports, database password and session key. Preserve the original session key if existing sessions should survive; changing it requires users to sign in again. Database passwords can differ between deployments.

```sh
node deploy/backup.mjs restore --env-file deploy/.env.recovery --backup backups/first --project enspatium-recovery
docker compose --env-file deploy/.env.recovery -p enspatium-recovery -f backups/first/compose.yaml -f backups/first/images.json up -d --no-build --wait
```

`restore` performs the same checks as `verify`, but keeps the new volumes after success and leaves services stopped. It refuses the source project and any target with existing containers, networks or volumes. It never merges a dump into an existing installation. The saved Compose configuration is validated to keep mounts and networks inside the new project. If restore fails, only the newly created recovery project is removed.

Use separate loopback ports or a test hostname first. Confirm `/api/health/db`, sign-in, a private Git clone, and downloads of current and older Object versions. Then plan the traffic switch; do not start a second deployment on ports already used by the original. Keep the original deployment's volumes until the recovered service has been accepted. Continue operating the recovered service with the saved Compose and image override files; replacing only the image with an incompatible release is not a database rollback.

## Limits and interruptions

- Run one backend, and stop all outside writers to its database/content. Do not edit physical files, run migrations or restart containers during backup. The tool verifies that its backend stayed stopped; it cannot prevent an administrator or another host process from changing storage.
- The backend gets up to eleven minutes to finish admitted work. A forced exit, OOM, or changed container state prevents a completed snapshot. An unclean shutdown leaves web traffic stopped for inspection instead of claiming success. A copy failure after a clean shutdown resumes the original service but leaves an incomplete output directory.
- One Docker lock container prevents overlapping backup/recovery commands for a project. If the operator process or host is interrupted, there may be an incomplete directory, a lock or a helper container. Confirm that the original command and its Docker work have terminated before removing their identified remnants and restarting the original deployment. A stopped lock container alone is not evidence that the command is inactive.
- This first version has no scheduler, automatic retention or point-in-time recovery. Recovery returns data to the selected snapshot; later writes remain only in the original deployment or a newer backup.

## Acceptance test

Build and start the disposable `enspatium-smoke` HTTPS deployment described in the main README. It must use `deploy/.env.smoke`, local port 18443, registration enabled, and an exported CA at `deploy/.env.smoke-ca.pem`.

```powershell
$env:DEPLOYMENT_URL = 'https://localhost:18443'
pnpm --filter @enspatium/server test:backup
```

The test creates real Git commits/tags and two Object versions, takes a backup, and then changes the original data. It rejects a damaged archive, existing recovery targets and a retained volume without containers. It also detects changed bytes in a restored version even when its size matches. It exercises temporary verification, starts a separately restored HTTPS service, signs in, clones through its proxy, and downloads both saved Object versions. Newer source data must remain unchanged. Test recovery volumes and local backup artifacts are removed; the disposable source deployment is retained.

References: [PostgreSQL logical dumps](https://www.postgresql.org/docs/17/app-pgdump.html), [Docker image archives](https://docs.docker.com/reference/cli/docker/image/save/), [Compose shutdown behavior](https://docs.docker.com/compose/support-and-feedback/faq/).
