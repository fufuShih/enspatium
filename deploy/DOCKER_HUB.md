# Docker Hub

For deployment, follow [README](README.md#initial-installation). This page is only for publishing a new release.

1. Create `enspatium-server` and `enspatium-web` repositories in your Docker Hub namespace.
2. In the source checkout's `deploy/.env`, set:

```dotenv
ENSPATIUM_IMAGE_PREFIX=felixshih/
ENSPATIUM_IMAGE_TAG=v0.1.1
```

Use your namespace with a trailing slash and a new tag for each release. Keep the other deployment settings.

3. Log in, build and push from the repository root:

```powershell
docker login --username your-docker-id
docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.build.yaml build server web
docker compose --env-file deploy/.env push server web
```

Use a Docker Hub Read/Write access token at the password prompt. Check both repositories' Tags tabs afterward. Private images require login on the deployment host too.

Only application images are uploaded; secrets, database records and Space files are excluded. Build for a Linux architecture supported by the deployment host.
