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

This type-checks and uses Vitest to run the real HTTP API and Git CLI acceptance flow: register/login, create an organization and private Space, clone as Reader, push as Writer, deny writes after downgrade, revoke access after member removal, change the default branch and verify a fresh clone, revoke a token, and sign out. The Object integration scenario also covers folder grouping beyond 100 objects, cursor pagination, Unicode and literal prefix filters, file/folder collisions, uploads/downloads/deletion, access denial, and missing storage. The version integration scenario upgrades existing objects from migration 0009 and verifies immutable history, concurrent writes, rollback, quota retention, delete/restore, checksums, and read/write permissions. Retention tests cover count and age boundaries, current-version protection, owner settings, quota release, inaccessible storage, and retry after a failed purge. The backend's `vitest.integration.config.ts` sets the separate test paths and longer timeouts. It does not run browser UI tests. `pnpm test` remains independent of this integration suite.

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

Playwright type-checks and runs six Chromium scenarios: UI registration/login and Space creation, settings persistence after reload (name, visibility and Git default branch), organization/Space membership across accounts, commit history/diff browsing across branches, and Object folder navigation with file upload, preview, download and deletion, plus Object version uploads, historical downloads, restoration and deleted-file recovery. The tests use actual pages and HTTP requests, with no mocked API responses. Git branches for settings and history scenarios are seeded in isolated test repositories; `pnpm test:integration` continues to verify actual clone/push permissions.

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

Object Spaces show files and folders with icons, grouping slash-separated object keys one level at a time. Use the breadcrumbs or **Back to parent folder** to navigate; the current path, filename filter and page cursor are stored in the URL. Folders appear before files, with up to 100 entries per page and **Next page** navigation. Grouping happens before pagination, so folders are not hidden by a large number of descendant files. Choose **Upload file** to upload one file (up to 100 MiB) into the current folder, or click a filename to open its details and preview. Text previews support up to 1 MiB and common raster images up to 10 MiB; HTML and SVG are shown as text. Other formats show file details with a download option. Use the separate download icon or the viewer's **Download** button to save a file. Uploads preserve file bytes and MIME types; uploading the same key creates a new version and preserves previous bytes. The backend enforces read/write permissions and storage quotas. File lists require sign-in; the filename-prefix filter applies within the current folder. **New folder** opens an empty path, which appears in its parent only after a file is uploaded. Empty folders have no separate metadata records. File/folder name conflicts are rejected. Use **Delete file** in the preview and confirm to move one file to **Deleted files**, preserving all versions; parent folder lists and storage usage are refreshed. Closing the viewer cancels its preview request and releases image URLs; leaving the page cancels active transfers. Leaving a folder cancels its active transfers. Drag-and-drop uploads and recursive folder deletion are not included.

Git Spaces support read-only branch selection, folder navigation, text previews (up to 1 MiB), and a root README preview. Branch and path are stored in `ref`, `path`, and `view` query parameters, so browser history and reloads preserve the view. Switching branches returns to the root. Binary files and submodules are identified without attempting to display them as text. README Markdown uses safe React rendering with raw HTML omitted; images are shown as alt text and relative links as text. Creating commits, editing files, and creating/deleting branches remain outside the UI.

The **Commits** tab lists the selected branch's history in pages of 30, with author, timestamp and short SHA. Open a commit to see its full message, changed files, and a unified diff with line numbers and green/red additions/removals. Initial commits show added content; merge commits compare against their first parent. Renames, deletions, file mode changes and binary files are identified. The selected commit/file and history page are stored in the URL. Pagination stays pinned to a commit snapshot, so a concurrent push does not shift pages; **Latest commits** returns to the current branch tip. Diffs are limited to 1 MiB per response and 3,000 displayed lines per file, with an explicit message when a limit is reached. Commit text is rendered as text, including HTML-like content.

Space owners can open **Settings** at `/:account/:spaceSlug/settings` to edit the display name and public/private visibility while keeping the URL unchanged. Git settings select an existing default branch for browsing and future clones; empty repositories must receive their first push before a branch can be selected. The API enforces owner permissions and rejects missing branches, tags, and commit IDs. **Delete Space** is under **Danger zone**, with the existing URL-name confirmation.

Use **Clone** to copy the repository's HTTP(S) URL. Empty Git Spaces show a copyable push command for an existing local repository and **Refresh files** to load the first push. Git URLs use the same `/api` proxy as the frontend; Git authentication uses an access token as the password.

Open **Access tokens** in the user menu or **Manage access tokens** in the Clone popup to visit `/settings/access-tokens`. Create a named token with read-only or read/write Git permissions and a 30-day (default), 90-day, or unlimited lifetime. Copy the full token when it is created; it is cleared when you select **Done**, leave the page, or sign out, and is never stored in application query caches or browser storage. The list shows permissions, status, expiration, and last use. Revocation requires an inline confirmation and immediately disables that token. Token scopes do not grant access beyond your existing Space permissions.

Missing Space storage returns `503 SPACE_STORAGE_UNAVAILABLE` instead of an empty listing; missing content for an existing Object record returns `404 OBJECT_CONTENT_MISSING`. Records are preserved, uploads do not recreate missing Space directories, and the UI supports retry after storage is restored. Space owners can use **Delete Space**, confirm its URL name, and remove the Space even if its directory is already missing, provided the storage root is accessible and unchanged. Deletion removes related Object/member records and preserves audit history.

Storage-root identity checks cover disappearance or replacement during the running server process. Deployment must ensure the correct `DATA_ROOT` volume is mounted before startup; these checks are not persistent volume identification or a backup/recovery system.

## Object versions

Stop the backend before upgrading an existing database, then run:

```powershell
pnpm --filter @enspatium/server db:migrate
```

Restart the backend with the new code. Migration 0010 registers existing files as their first version without moving or rewriting any bytes. Old paths become immutable version locators; new content is stored under random server-generated IDs within the same Space directory. The migration does not recover missing files or verify their contents. Missing content remains an explicit error; restoration verifies the original size and checksum before committing the new version.

Upload the same filename to create a new version. Open **Versions** in the file preview to browse history, select a version to preview it, and use **Download** for that selected version. **Restore** copies the selected content into a new current version. **Delete file** adds a deletion marker and hides the file from the normal list. Use **Deleted files**, open the file, and restore a content version to recover it. Restoring preserves newer history until the retention policy expires it. Versions show the upload time, author, size, and version number, with pagination for older entries.

All stored versions count toward the Space quota, including deleted files and restored copies. Deletion does not free capacity. Retention cleanup permanently purges expired historical versions and then releases their capacity; deleting the entire Space removes all versions. A version history is not a backup or a whole-Space snapshot.

History, deleted-file listings, and historical content require sign-in and Space read access. Upload, deletion, and restoration require write access. Anonymous downloads of public Spaces return only current, non-deleted content. File/folder conflicts remain rejected. Upload and delete accept an optional `expectedVersion` query parameter (a version UUID, or `none` for a new key); the UI sends the observed head. Restore requires it. Stale writes return 409; Space locking makes quota checks and version switching atomic. Failed database writes retain the previous head, and cleanup checks for a committed version before removing new bytes. Process interruption can still leave orphan content for manual reconciliation.

The generated Object client includes `getObjectHead`, `listObjectVersions`, `downloadObjectVersion`, and `restoreObjectVersion`. The new endpoints live outside `/objects/*` so existing object keys remain valid. OpenAPI and TypeScript clients are regenerated with the existing `pnpm generate:api` command.

## Object retention

In an Object Space's **Settings > Version retention**, owners can set **Maximum versions** (default 3, range 1-1000) and **Inactive retention (days)** (default 7, range 1-36500). Each Space has its own policy. Maximum versions counts content versions, including the current one; deletion markers do not count. A non-current version is eligible for permanent deletion when it exceeds the count **or** has been inactive for the configured duration. The current content version never expires automatically, even if it was uploaded years ago.

For example, with the defaults, uploading version 4 makes version 1 eligible at the next sweep. A version that has been inactive for 7 days expires even if only two versions remain. The inactive clock starts when a version is replaced or the file is deleted, rather than when the content was originally uploaded. Restoring creates fresh content and a new current version. Once a deleted file has no retained history and its deletion marker is old enough, it disappears from **Deleted files**.

Migration 0011 adds the policy and backfills inactive timestamps from the next revision's creation time. Stop the backend, run the same migration command above, and restart it. The policy applies to existing history, including during the first startup sweep; increasing a limit cannot recover already purged content.

The normal backend entry point starts one cleanup sweep after listening, then repeats every hour. Set `OBJECT_CLEANUP_INTERVAL_SECONDS` (default 3600, minimum 60) to change the sweep interval. The sweep is sequential and uses batches of at most 100 newly marked versions and 100 pending purges per Space; large backlogs may require several sweeps. Uploads can temporarily exceed the retained-version count until cleanup runs. No separate Worker, cron service, or additional dependency is required.

Cleanup durably marks expired versions before removing bytes, hides them from history/download/restore, and locks the Space while deleting content and updating metadata/audit. Capacity is released only after successful metadata removal. Failed or interrupted purges retain their marker and quota charge for retry, even if the policy is subsequently relaxed. Missing mounts or inaccessible storage block cleanup and preserve records. The cleanup touches only version records with known storage locators; unrelated/orphan files are not automatically deleted.

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
