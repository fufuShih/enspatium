# Docker Hub

For deployment, follow [README](README.md#initial-installation). This page is only for publishing a new release.

1. Create `enspatium-server` and `enspatium-web` repositories in your Docker Hub namespace.
2. Log in, build and push from the repository root (replace `felixshih` with your Docker Hub namespace):

```powershell
docker login --username felixshih
docker build --target server -t felixshih/enspatium-server:v0.2.0 .
docker build --target web -t felixshih/enspatium-web:v0.2.0 .
docker push felixshih/enspatium-server:v0.2.0
docker push felixshih/enspatium-web:v0.2.0
```

Use a Docker Hub Read/Write access token at the password prompt. Check both repositories' Tags tabs afterward. Private images require login on the deployment host too.

Building does not require deployment secrets or `deploy/.env`. Use Linux containers matching the deployment host's architecture. Only application images are uploaded; secrets, database records and Space files are excluded.

3. On the deployment host, set these in its `.env` (or `deploy/.env` inside the source checkout):

```dotenv
ENSPATIUM_IMAGE_PREFIX=felixshih/
ENSPATIUM_IMAGE_TAG=v0.2.0
```

Keep the existing password, session key and domain. Use a new tag for each release. For an existing installation, follow [Upgrade](UPGRADE.md); for a new installation, follow [Deployment](README.md).
