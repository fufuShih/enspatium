# Deployment

## Initial installation

Use Docker with Linux containers and Compose. Point your domain at the host and open TCP ports 80 and 443.

1. Put [compose.yaml](../compose.yaml) and your own `.env` in a new deployment directory.
2. Copy [.env.example](.env.example) as the template. Set `POSTGRES_PASSWORD`, `SESSION_KEY` and `SITE_ADDRESS`.
3. Generate two independent 64-character hex secrets for the password and key, for example by running `openssl rand -hex 32` twice.

```sh
docker compose pull
docker compose up -d
```

Images default to `felixshih/enspatium-server:v0.3.0` and `felixshih/enspatium-web:v0.3.0`. Migrations run automatically. No source code or build tools are needed.

Inside the development checkout, preserve its root `.env`: use `deploy/.env` and add `--env-file deploy/.env` to Compose commands.

## First administrator

Registration is closed by default. Create a private `.env.admin.json` containing `displayName`, `email` and `password`, then run:

```sh
docker compose exec -T server node packages/server/dist/scripts/bootstrap-admin.js < .env.admin.json
```

PowerShell:

```powershell
Get-Content -Raw -Encoding utf8 .env.admin.json | docker compose exec -T server node packages/server/dist/scripts/bootstrap-admin.js
```

Delete the credential file afterward. This works only when no administrator exists. Manage subsequent accounts in **Site administration > Users**.

## Daily use

```sh
docker compose ps
docker compose logs --tail 100 server
docker compose stop
```

Check HTTPS, `/api/health/db`, sign-in and Git clone/push after installation. Use an access token as the Git password.

App/PWA entry pages come from Fastify through Caddy's `/app/*` handler, before the generic SPA fallback. Deploy server and web images from the **same build**: the server includes both built HTML entries and `pwa-shell.json`, and web serves their referenced assets. Migration 0022 stores sanitized installation icons in PostgreSQL. Owners enable public installation metadata from Space Settings; private content still requires authorization. Workers cache only a generic offline page and its integrity-checked static dependencies, partitioned by App/build. Mixed builds fail offline setup rather than caching mismatched bytes. Use a trusted HTTPS certificate; bypassing a page's certificate warning does not reliably permit Service Worker installation.

For non-Docker deployments, build the web app and point the server's `WEB_ROOT` at that build directory; proxy `/app/*` to Fastify and serve the matching assets normally. Missing HTML returns 503. Keep manifest/worker responses out of SPA fallbacks and shared caches. See the [App delivery guide](../packages/server/src/apps/README.md#pwa-delivery).

The optional browser check `pnpm test:e2e -- app-pwa-deployment.spec.ts` requires `PWA_DEPLOYMENT_URL=https://localhost:<port>` pointing to a disposable local deployment with registration enabled. For an untrusted test certificate only, `PWA_TEST_CERT_SPKI` can pin its base64 SHA-256 public-key digest in the test browser; this does not change OS trust or production settings. The check covers secure cookies, initial/deep-link HTML, separate manifests/workers, Note/EPUB/PDF/Media with production headers, actual offline reload/reconnect, cache contents and per-App cleanup. Installation menus/prompts still require desktop Chromium, Android and iOS device acceptance.

- Keep the same secrets and volumes when updating. Do not use `down --volumes` to restart.
- Run one backend; do not edit its database or content files externally.
- **Site administration** provides system status, background storage checks and Git maintenance. Start checks in **Storage** and return to **Jobs** for persisted reports, queued cancellation or manual retries. Back up before maintenance; Git requests may be busy while it runs.
- Default Git limits: 100 MiB per push, 1 GiB of objects per repository, 4 concurrent commands and 1 GiB free-disk reserve. Override the corresponding settings in [compose.yaml](../compose.yaml) through `.env`.

[Publish images](DOCKER_HUB.md) ? [Back up and restore](BACKUP.md) ? [Upgrade](UPGRADE.md)

## Small-trial implementation checklist

- [x] HTTPS deployment, persistent volumes and automatic migrations.
- [x] Registration controls, account management and authentication limits.
- [x] Git push, storage and concurrency limits.
- [x] Consistent backup and isolated restore verification.
- [x] System monitoring, Git maintenance and upgrade/recovery verification.
- [x] Persistent background checks with crash recovery and backup/restore verification.
- [x] Default branch protection against force pushes and deletion.
- [x] Branch/Tag browsing, history and ZIP downloads.
- [x] Branch/Tag switching with file commit details.
- [x] Version comparison with changed files and diff.

Start with invited users. Validate the real domain/certificate before launch. Email verification, password recovery and per-account Space/storage limits remain prerequisites for unrestricted public registration.
