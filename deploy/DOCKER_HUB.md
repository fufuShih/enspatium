# Publish to Docker Hub

Run these commands from the repository root using Docker Desktop with Linux containers, or Docker Engine with Compose 2.20+. The root Compose file includes `deploy/compose.yaml`; both entry points use the same deployment and volume names.

## 1. Create the repositories

In Docker Hub, open **My Hub > Repositories > Create repository**. Select your account or organization namespace and create:

- `enspatium-server`
- `enspatium-web`

Choose Public if anyone should be able to pull your images, or Private to restrict access. The migration service uses the server image; PostgreSQL uses the official image and does not need to be uploaded.

## 2. Configure the image names

On first setup, copy `deploy/.env.example` to `deploy/.env`. If that file already exists, edit it without replacing its secrets. Complete the database password, session key and hostname settings using the [deployment instructions](README.md#initial-installation).

Set these values in `deploy/.env`, replacing `yourname` with the chosen Docker Hub namespace:

```dotenv
ENSPATIUM_IMAGE_PREFIX=yourname/
ENSPATIUM_IMAGE_TAG=v0.1.0
```

The trailing `/` is required. This produces `yourname/enspatium-server:v0.1.0` and `yourname/enspatium-web:v0.1.0`. Use a new tag for each release so an existing release can be identified reliably. Leaving the prefix empty keeps the original local image names.

## 3. Log in, build and push

In Docker account settings, open **Personal access tokens** and generate a token with Read and Write permissions. Use an expiration appropriate for your work. Log in using your personal Docker ID (also when publishing to an organization):

```powershell
docker login --username your-docker-id
```

Paste the token at the password prompt. Keep it out of Compose files, `.env` and Git. Your account must have write access to the selected namespace.

```powershell
docker compose --env-file deploy/.env build server web
docker compose --env-file deploy/.env config --images
docker compose --env-file deploy/.env push server web
```

Check both repositories' **Tags** tabs for `v0.1.0`. Publishing uploads application images, not database records, Space contents or named volumes. The Docker build context excludes `.env` files, local `data/` and backups. This build uses the Docker engine's current Linux architecture; the target host must support that architecture.

## 4. Install the published release

On the target host, check out the project, configure its own `deploy/.env` secrets and HTTPS hostname, and set the same image prefix and release tag. For private repositories, log in there using an account/token with Read access.

```powershell
docker compose --env-file deploy/.env pull db server web
docker compose --env-file deploy/.env up -d --no-build --pull never --wait
```

Pulling `server` also supplies the identical image used by `migrate`, which deliberately has `pull_policy: never`. The database starts first, migrations complete, then the backend and web start. The `--no-build` flag uses the published images. Finish the initial administrator setup in [Deployment](README.md#initial-installation).

For an existing installation, follow the [backup and upgrade procedure](UPGRADE.md) before changing the release tag. Keep its database password and session key, and retain the named volumes.

References: [Create a repository](https://docs.docker.com/docker-hub/repos/create/), [Personal access tokens](https://docs.docker.com/security/access-tokens/personal-access-tokens/), [Push images](https://docs.docker.com/docker-hub/repos/manage/hub-images/push/), [Compose include](https://docs.docker.com/reference/compose-file/include/).
