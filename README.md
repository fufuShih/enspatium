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

## Unit tests

Both frontend and backend tests use Vitest. Run them together from the repository root:

```powershell
pnpm test
```

Run one side with `pnpm --filter @enspatium/web test` or `pnpm --filter @enspatium/server test`. Use `test:watch` instead of `test` to rerun tests as files change. Frontend API client tests can also run alone with `pnpm --filter @enspatium/web test:api`.

Each package has a small `vitest.config.ts` with explicit test paths. Frontend tests cover client requests and application logic in Node, with fetch spies restored before each test. Backend tests cover services and routes using mocks and temporary filesystem fixtures; Git-related tests require Git on `PATH`. These suites do not require a database, running servers, or browser installation. Browser scenarios remain in Playwright Test and are excluded from Vitest discovery.

## Integration tests

With Git on `PATH`, PostgreSQL running, and `DATABASE_URL` configured in the root `.env`, run:

```powershell
pnpm test:integration
```

This type-checks and uses Vitest to run the real HTTP API and Git CLI acceptance flow: register/login, create an organization and private Space, clone as Reader, push as Writer, deny writes after downgrade, revoke access after member removal, change the default branch and verify a fresh clone, revoke a token, and sign out. The backend's `vitest.integration.config.ts` sets the separate test paths and longer timeouts. It does not run browser UI tests. `pnpm test` remains independent of this integration suite.

No running frontend/backend or manual migration is needed. Each run creates a unique `ensp_it_*` PostgreSQL schema, applies the actual SQL migrations (including isolated migration tracking tables), starts a backend on a random local port, and uses a temporary storage directory. The database user needs `CREATE SCHEMA` permission. Test data, tokens, audit records, and files are removed on success or assertion failure; existing application schemas and `data/` are not used. Git credentials and signing settings are isolated for the test process, so Credential Manager will not prompt.

To use a separate test database, set `INTEGRATION_DATABASE_URL` before running the same command; it overrides `DATABASE_URL`. No additional packages or browser downloads are required. If setup fails, the command reports the missing prerequisite and exits unsuccessfully. Forced process termination cannot guarantee cleanup; cleanup failures report the exact temporary schema and directory for inspection.

## Browser end-to-end tests

Install the Chromium browser once after `pnpm install`:

```powershell
pnpm --filter @enspatium/web exec playwright install chromium
```

Then, with PostgreSQL running and the same database configuration as the integration suite:

```powershell
pnpm test:e2e
```

Playwright type-checks and runs three Chromium scenarios: UI registration/login and Space creation, settings persistence after reload (name, visibility and Git default branch), and organization/Space membership across owner and member accounts. The tests use actual pages and HTTP requests, with no mocked API responses. Git branches for the settings scenario are seeded in the isolated test repository; `pnpm test:integration` continues to verify actual clone/push permissions.

The worker automatically starts its own Vite and backend servers on available local ports. It shares the integration suite's temporary schema, migration and storage setup; each worker gets a fresh environment and each test gets a fresh browser context. Existing dev servers are not reused or stopped. Servers, schema and temporary files are cleaned up even when an assertion fails. Tests run with one worker and no retries by default.

Failed tests keep screenshots and traces under `apps/web/test-results/`. The HTML report is under `apps/web/playwright-report/`; both directories are ignored by Git. Open the latest report with:

```powershell
pnpm --filter @enspatium/web exec playwright show-report
```

For a visible browser, run `pnpm --filter @enspatium/web exec playwright test --headed`. No browser login or saved authentication state from your development session is used. As with integration tests, force-killing the process may interrupt cleanup.

## Authentication

Start PostgreSQL and configure the root `.env` using `.env.example` (including `DATABASE_URL` and a random 32-byte hex `SESSION_KEY`). Apply migrations with `pnpm --filter @enspatium/server db:migrate`, then run `pnpm dev` and `pnpm --filter @enspatium/web dev` in separate terminals.

Open `/register` to create an account, then sign in at `/login`. Authentication uses the generated API client and the backend's HttpOnly session cookie. Refreshing the page restores the user through `/auth/me`; the profile URL uses the personal namespace returned by `/namespaces`. The user menu signs out through `/auth/logout`.

After signing in, use the navigation's Create menu to open `/space/create`. Owner choices come from the backend and include only namespaces you own. Creation supports Git repositories and object storage, with private visibility by default. The URL name is editable and must contain 3–40 lowercase letters, numbers, or single hyphens.

Creation updates the account list and opens `/:account/:spaceSlug`. Account profiles, organization icons, Space lists, and Space details use real API data and survive reloads. Lists require namespace membership; public Space details can be opened without signing in. Run frontend tests with `pnpm --filter @enspatium/web test`.

Signed-in users can choose **Create organization** from the navigation menu to open `/organization/create`. Organizations use the same `/:account` profile route as personal accounts. Their owner can open the **Members** tab to add registered users by email or remove them with confirmation. Removing an organization member also removes their memberships in its Spaces. Reserved application URLs (including `login`, `settings`, and `organization`) cannot be used for new organizations.

In an organization's **Space settings → Members**, Space owners can add organization members as **Reader** or **Writer**, change their role, or remove their access. Readers can view/download and clone/fetch; writers can also push and manage Object files. Owners cannot be changed or removed through these controls. Membership does not grant access to every private Space automatically: add the user to the organization first, then to each Space they need. Personal Spaces do not support additional members. Public content remains readable after member removal. Git clients still need an access token with the appropriate Git scope, and permissions are checked on each request. Email invitations and group management are not included.

Object Spaces display a flat file list with file-type icons. Choose **Upload file** to upload one file (up to 100 MiB), or click a filename to open its details and preview. Text previews support up to 1 MiB and common raster images up to 10 MiB; HTML and SVG are shown as text. Other formats show file details with a download option. Use the separate download icon or the viewer's **Download** button to save a file. Uploads preserve file bytes and MIME types; duplicate filenames are rejected. The backend enforces read/write permissions and storage quotas. File lists require sign-in and show up to 100 results; use the filename-prefix filter to narrow longer lists. Closing the viewer cancels its preview request and releases image URLs; leaving the page cancels active transfers. Object folder navigation and drag-and-drop uploads are not included yet.

Git Spaces support read-only branch selection, folder navigation, text previews (up to 1 MiB), and a root README preview. Branch and path are stored in `ref`, `path`, and `view` query parameters, so browser history and reloads preserve the view. Switching branches returns to the root. Binary files and submodules are identified without attempting to display them as text. README Markdown uses safe React rendering with raw HTML omitted; images are shown as alt text and relative links as text. Git editing, commits, and branch creation/deletion remain outside the UI.

Space owners can open **Settings** at `/:account/:spaceSlug/settings` to edit the display name and public/private visibility while keeping the URL unchanged. Git settings select an existing default branch for browsing and future clones; empty repositories must receive their first push before a branch can be selected. The API enforces owner permissions and rejects missing branches, tags, and commit IDs. **Delete Space** is under **Danger zone**, with the existing URL-name confirmation.

Use **Clone** to copy the repository's HTTP(S) URL. Empty Git Spaces show a copyable push command for an existing local repository and **Refresh files** to load the first push. Git URLs use the same `/api` proxy as the frontend; Git authentication uses an access token as the password.

Open **Access tokens** in the user menu or **Manage access tokens** in the Clone popup to visit `/settings/access-tokens`. Create a named token with read-only or read/write Git permissions and a 30-day (default), 90-day, or unlimited lifetime. Copy the full token when it is created; it is cleared when you select **Done**, leave the page, or sign out, and is never stored in application query caches or browser storage. The list shows permissions, status, expiration, and last use. Revocation requires an inline confirmation and immediately disables that token. Token scopes do not grant access beyond your existing Space permissions.

Missing Space storage returns `503 SPACE_STORAGE_UNAVAILABLE` instead of an empty listing; missing content for an existing Object record returns `404 OBJECT_CONTENT_MISSING`. Records are preserved, uploads do not recreate missing Space directories, and the UI supports retry after storage is restored. Space owners can use **Delete Space**, confirm its URL name, and remove the Space even if its directory is already missing, provided the storage root is accessible and unchanged. Deletion removes related Object/member records and preserves audit history.

Storage-root identity checks cover disappearance or replacement during the running server process. Deployment must ensure the correct `DATA_ROOT` volume is mounted before startup; these checks are not persistent volume identification or a backup/recovery system.

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
