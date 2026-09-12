# Project

- `apps/web`: React, Chakra UI, and Vite.
- `packages/server`: Fastify, PostgreSQL, Git, and Object storage.
- `compose.yaml`: published-image deployment; `deploy/compose.build.yaml`: optional source-build overlay.

## Development

Use Node 24+, pnpm 12+, Git, and PostgreSQL 17. Run commands from the repository root.

1. Run `pnpm install`. Copy `.env.example` to `.env`; configure `DATABASE_URL` and a random 64-character hex `SESSION_KEY`.
2. Migrate with `pnpm --filter @enspatium/server db:migrate`.
3. Run `pnpm dev` and `pnpm --filter @enspatium/web dev` in separate terminals.

## Conventions

- Keep changes simple and documentation concise. README covers the overview and quick start.
- Use English UI text and Chakra UI styling inside components; shared global styles stay in `styles`.
- Change backend API schemas, then run `pnpm generate:api`; commit generated types/clients without hand-editing them.
- Run checks relevant to the change: `pnpm test` (Vitest), `pnpm test:integration`, `pnpm test:e2e` (Playwright), or `pnpm build`. Integration/browser tests need PostgreSQL; browser tests also need Chromium.
- Keep development `.env` separate from `deploy/.env`; use `--env-file deploy/.env` for deployment commands inside this checkout.
- Never commit secrets.
