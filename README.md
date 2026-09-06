# Enspatium

Enspatium is a self-hosted platform for managing content, storage, and collaboration through one unified concept: **Everything is a Space.**


## Project Structure

- `apps` — deployable frontend applications
- `packages` — Node.js server and shared packages

## Development

```powershell
pnpm install
pnpm dev
```

The server exposes `GET http://127.0.0.1:3000/health`.

## Authentication

Start PostgreSQL and configure the root `.env` using `.env.example` (including `DATABASE_URL` and a random 32-byte hex `SESSION_KEY`). Apply migrations with `pnpm --filter @enspatium/server db:migrate`, then run `pnpm dev` and `pnpm --filter @enspatium/web dev` in separate terminals.

Open `/register` to create an account, then sign in at `/login`. Authentication uses the generated API client and the backend's HttpOnly session cookie. Refreshing the page restores the user through `/auth/me`; the profile URL uses the personal namespace returned by `/namespaces`. The user menu signs out through `/auth/logout`.

After signing in, use the navigation's Create menu to open `/space/create`. Owner choices come from the backend and include only namespaces you own. Creation supports Git repositories and object storage, with private visibility by default. The URL name is editable and must contain 3–40 lowercase letters, numbers, or single hyphens.

Creation updates the account list and opens `/:account/:spaceSlug`. Account profiles, organization icons, Space lists, and Space details use real API data and survive reloads. Lists require namespace membership; public Space details can be opened without signing in. File browsing, uploads, and Git operations are outside this UI flow. Run frontend tests with `pnpm --filter @enspatium/web test`.

## API generation

After changing backend route schemas, run from the repository root:

```sh
pnpm generate:api
```

This exports `packages/server/openapi.json` from the Fastify TypeBox schemas, then generates TypeScript request/response types, fetch functions, and TanStack Query hooks in `apps/web/src/api/generated/`. Orval's `mode: 'tags'` creates one client file per backend tag (such as `auth.ts` and `spaces.ts`), with shared types in `api.schemas.ts`. No running server, database, or environment configuration is needed. Keep the generated files in version control; do not edit them manually.

Each REST route has a stable `operationId`, such as `listSpaces` or `createSpace`. Raw Git transport routes are excluded. The running backend also serves the specification at `GET /openapi.json`.

```tsx
import { useListSpaces, useCreateSpace } from './api/generated/spaces'

// Inside a component under the existing QueryClientProvider:
const spaces = useListSpaces('my-account')
const create = useCreateSpace()
const handleCreate = () => create.mutate({
  namespaceSlug: 'my-account',
  data: { name: 'Demo', slug: 'demo', type: 'git' },
})
```

Call mutations from event handlers. Generated requests use `/api` and include session cookies. Vite proxies `/api/*` to `http://127.0.0.1:3000/*`; production hosting should provide the same reverse proxy. Authentication and Space pages use real API requests.

Individual commands: `pnpm --filter @enspatium/server generate:openapi` and `pnpm --filter @enspatium/web generate:api`. Verify with `pnpm --filter @enspatium/server test` and `pnpm --filter @enspatium/web test:api`.
