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

Images default to `felixshih/enspatium-server:v0.1.0` and `felixshih/enspatium-web:v0.1.0`. Migrations run automatically. No source code or build tools are needed.

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

- Keep the same secrets and volumes when updating. Do not use `down --volumes` to restart.
- Run one backend; do not edit its database or content files externally.
- **Site administration** provides system status, storage integrity checks and Git maintenance. Back up before maintenance; Git requests may be busy while it runs.
- Default Git limits: 100 MiB per push, 1 GiB of objects per repository, 4 concurrent commands and 1 GiB free-disk reserve. Override the corresponding settings in [compose.yaml](../compose.yaml) through `.env`.

[Publish images](DOCKER_HUB.md) ? [Back up and restore](BACKUP.md) ? [Upgrade](UPGRADE.md)

## Small-trial implementation checklist

- [x] HTTPS deployment, persistent volumes and automatic migrations.
- [x] Registration controls, account management and authentication limits.
- [x] Git push, storage and concurrency limits.
- [x] Consistent backup and isolated restore verification.
- [x] System monitoring, Git maintenance and upgrade/recovery verification.
- [x] Default branch protection against force pushes and deletion.
- [x] Branch/Tag browsing, history and ZIP downloads.
- [x] Branch/Tag lists with latest commit details.
- [x] Version comparison with changed files and diff.

Start with invited users. Validate the real domain/certificate before launch. Email verification, password recovery and per-account Space/storage limits remain prerequisites for unrestricted public registration.
