# Enspatium

A self-hosted home for Git repositories, versioned files, and content apps.

**Everything is a Space.**

## Features

- **Git** ? HTTPS clone/push, Branch/Tag browsing, commit history, version comparison, and ZIP downloads.
- **Object storage** ? Folder uploads, previews, version restore, configurable retention, and batch file operations.
- **App Pages** — Built-in Media player, EPUB/PDF library, and Markdown notes, using the same files and permissions.
- **Administration** ? Public/private Spaces, organization access, account management, and storage checks.

## Deploy with Docker

Use Docker with Linux containers. Point your domain at the host and open ports 80 and 443.

1. Put [compose.yaml](compose.yaml) in a new deployment directory.
2. Copy [deploy/.env.example](deploy/.env.example) beside it as `.env`.
3. Set `POSTGRES_PASSWORD`, `SESSION_KEY`, and `SITE_ADDRESS`. Use two independent random 64-character hex secrets for the password and key.

```sh
docker compose pull
docker compose up -d
```

Compose uses the published `felixshih/enspatium-server` and `felixshih/enspatium-web` images. Migrations run automatically; no source checkout or build is needed.

Registration is closed by default. Follow [first administrator setup](deploy/README.md#first-administrator) after starting the service. Keep your secrets and data volumes when upgrading.

## Development

See [AGENTS.md](AGENTS.md) for project structure, setup, commands, and coding conventions.

## Documentation

- [Deployment](deploy/README.md) ? [Docker Hub](deploy/DOCKER_HUB.md)
- [Backup and restore](deploy/BACKUP.md) ? [Upgrades](deploy/UPGRADE.md)
- [Frontend App plugins](apps/web/src/pages/AppPages/README.md) ? [Backend App plugins](packages/server/src/apps/README.md)
