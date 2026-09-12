# Single-server deployment

This deployment runs one backend process, PostgreSQL and Caddy. It builds the real frontend and backend, applies migrations before starting the backend, serves browser routes as an SPA, and proxies `/api/*` to the backend (including Git Smart HTTP). Caddy obtains and renews public HTTPS certificates for your hostname. Only ports 80 and 443 are published; PostgreSQL and the backend stay on an internal network. Git runs as the unprivileged `node` user.

## Initial installation

Use a Linux host with Docker Engine and the Compose plugin, or Docker Desktop with Linux containers for local verification. Install from a reviewed Git commit. Point your hostname at the host and allow inbound TCP 80 and 443 before requesting a public certificate.

1. Copy `deploy/.env.example` to `deploy/.env`.
2. Generate two independent secrets with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Set `POSTGRES_PASSWORD` and `SESSION_KEY`; use hex for the password so it is safe in the connection URL.
3. Set `SITE_ADDRESS=https://your-hostname` and `ENSPATIUM_IMAGE_TAG` to the release/commit identifier.
4. From the repository root, run:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --wait
```

Open the site and check `/api/health/db`. Verify a nested browser URL after reloading, sign-in, Space creation, and clone/push through the displayed HTTPS clone URL. An access token is the Git password. The production backend refuses insecure cookies or the public development session key.

Public registration is closed by default in production. For the initial administrator only, create a private `deploy/.env.admin.json` file with `displayName`, `email`, and `password` string fields, then pipe it to the one-time bootstrap command. In PowerShell:

```powershell
Get-Content -Raw -Encoding utf8 deploy/.env.admin.json | docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T server node packages/server/dist/scripts/bootstrap-admin.js
```

On Linux, use the same Docker command with `< deploy/.env.admin.json`. Remove that credential file after successful setup. The command creates a new account and personal namespace atomically and refuses to run if any administrator already exists; it never promotes an existing email. Subsequent accounts are created in **Site administration → Users**. Existing installations keep their current administrators. Bootstrap is the one installation step requiring host access; routine account administration uses the UI/API.

Administrators can search users, create accounts, and confirm disable/enable. Disabling preserves Spaces, invalidates old session cookies and revokes access tokens. Enabling requires a fresh login and new tokens; old credentials are not revived. Checks apply to new requests, not bytes already downloaded or transfers already admitted. An administrator cannot disable their own account. Public content remains publicly readable.

Authentication uses per-process, bounded in-memory rate limits, resetting on backend restart: 20 login attempts per IP per minute, 10 per normalized email per minute, 5 registrations per IP per minute, and 300 Git transport requests per IP per minute across discovery/fetch/push. Responses return 429 with `Retry-After`. This is a single-server baseline, not a distributed abuse prevention service. Configure `LOGIN_RATE_LIMIT`, `LOGIN_ACCOUNT_RATE_LIMIT`, `REGISTRATION_RATE_LIMIT` and `GIT_AUTH_RATE_LIMIT` on the backend to adjust them. `TRUST_PROXY=true` trusts exactly one adjacent proxy; use it only with the backend inaccessible to clients, as in this Compose topology. Direct development servers default to ignoring forwarded IP headers.

Named volumes retain the database, Space contents and certificates across restarts and container replacement. Treat `deploy/.env` and the volumes as private. `docker compose down` stops this deployment; do not add `--volumes` when retaining service data. The local development database and repository `data/` are not imported automatically.

## Local HTTPS check

Set `SITE_ADDRESS=https://localhost`, `HTTP_BIND=127.0.0.1`, `HTTP_PORT=18080`, `HTTPS_PORT=18443` in a separate ignored env file. Use `-p enspatium-smoke` for an isolated Compose project with new volumes. Caddy uses its local CA; export the public root certificate from `/data/caddy/pki/authorities/local/root.crt` in the `web` container and trust it for your test client. Do not turn off session security to make production tests pass. This only verifies local HTTPS; a public deployment still needs its real DNS and certificate checked.

The Vitest deployment acceptance test expects this isolated project, configured with `deploy/.env.smoke` and already built/started. Set `REGISTRATION_ENABLED=true` only in this disposable test configuration. It creates test accounts and a repository, verifies HTTPS using the exported CA, exercises push/clone, and recreates the containers to verify volume/session persistence. It refuses non-local URLs. Run from PowerShell:

```powershell
docker compose --env-file deploy/.env.smoke -p enspatium-smoke -f deploy/compose.yaml cp web:/data/caddy/pki/authorities/local/root.crt deploy/.env.smoke-ca.pem
$env:DEPLOYMENT_URL = 'https://localhost:18443'
pnpm --filter @enspatium/server test:deployment
```

This test requires local dependencies installed with `pnpm install`, Git and Docker. It is separate from the normal unit/integration suites and leaves the isolated project's test data available for inspection. Stop that project after testing; remove only its disposable volumes when finished.

## Operations

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 100 server
```

Logs rotate at 10 MiB with three files per container. The backend healthcheck includes a database query. Restart policies recover exited containers; an unhealthy status alone does not restart a container. Operate a single backend instance: the storage write guard is process-local. Do not scale this service or allow another process to write `DATA_ROOT`.

For an upgrade, retain the prior images, stop web/backend traffic, take a consistent database/content backup, then build the new release and start it with `up -d --wait`. The migration container runs before the backend. Review migration compatibility before rollback: restoring an older image alone is insufficient when a schema change is incompatible. Restore a verified matching database/content backup when required. Backup and recovery tooling is tracked in the trial checklist below.

References: [Caddy SPA and API routing](https://caddyserver.com/docs/caddyfile/patterns), [Compose dependency readiness](https://docs.docker.com/compose/how-tos/startup-order/).

## Small-trial implementation checklist

This checklist tracks delivery, not permission to expose an unfinished service publicly. The initial audience is a small group of invited users on a single host.

- [x] Production deployment: reproducible images, HTTPS, persistent storage, migrations and deployment smoke test. Verified with local HTTPS, real Git push/clone, container recreation, and browser registration/login/reload. Public DNS/certificate validation remains deployment-specific.
- [x] Access management: registration switch, authentication throttling, account disable/re-enable and session/token access enforcement. Verified by API integration, admin browser workflow, bootstrap and production deployment tests.
- [ ] Git resource controls: push size and concurrent process limits, repository usage/quota, disk headroom.
- [ ] Consistent backup and isolated restore verification for PostgreSQL and content.
- [ ] Operations: health/disk/error visibility, controlled Git maintenance, upgrade/recovery verification.
- [ ] Default branch protection against force pushes and deletion.
- [ ] Tag browsing with files/history and ZIP downloads.
- [ ] Branch/tag lists with commit and update details.
- [ ] Branch/tag comparison with changed files and diff.

Before unrestricted public registration, also implement email verification/password recovery and per-account Space/storage limits. These are a separate gate beyond the invited trial.
