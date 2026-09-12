# Docker Hub

## Use the published images

Put the root `compose.yaml` and your own `.env` in a new directory on the deployment host. Only three settings are required:

```dotenv
POSTGRES_PASSWORD=your-random-hex-password
SESSION_KEY=your-random-64-character-hex-key
SITE_ADDRESS=https://git.example.com
```

Generate independent secrets; the values above are placeholders. Images default to `felixshih/enspatium-server:v0.1.0` and `felixshih/enspatium-web:v0.1.0`. Migrations use the server image automatically.

```sh
docker compose pull
docker compose up -d
```

Private repositories require `docker login` first. No source checkout, Dockerfile, Node.js or build is needed. Complete the initial admin setup in [Deployment](README.md#initial-installation). To update an existing service, retain its secrets and volumes and follow [Upgrades](UPGRADE.md).

## Publish a new release from source

Keep deployment settings in `deploy/.env` inside the source checkout, separate from its development `.env`. Set `ENSPATIUM_IMAGE_PREFIX=felixshih/` (or your namespace, including the trailing slash) and `ENSPATIUM_IMAGE_TAG` to a new release tag. Log in with an account that can write to the two Docker Hub repositories:

```powershell
docker login --username your-docker-id
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.build.yaml build server web
docker compose --env-file deploy/.env push server web
```

Use a Read/Write personal access token at the login password prompt. The build overlay is only needed for building; the root file already supplies the image names for pushing. Do not overwrite a released tag. Check each repository's Tags tab after pushing. Builds use the current Docker engine's Linux architecture; the deployment host must support it.

Only application images are published. Database records, Space files, volumes and local secrets are not included.

References: [Create repositories](https://docs.docker.com/docker-hub/repos/create/), [Access tokens](https://docs.docker.com/security/access-tokens/personal-access-tokens/), [Push images](https://docs.docker.com/docker-hub/repos/manage/hub-images/push/).
