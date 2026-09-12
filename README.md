# Enspatium

Enspatium is a self-hosted platform for managing content, storage, and collaboration through one unified concept: **Everything is a Space.**


## Project Structure

- `apps` — deployable frontend applications
- `packages` — Node.js server and shared packages

`apps/web/src/pages/SpacesPage` keeps its three page entries at the root. Supporting files are grouped one level below:

- `git/` — repository browsing, history and downloads
- `object/` — file browsing, uploads, versions, deletion and moves
- `settings/` — Space settings, members, retention and Space deletion
- `shared/` — Space URL/cache helpers and shared storage errors

## Development

For a single-host deployment and the small-trial delivery checklist, see [Deployment](deploy/README.md).

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

Playwright type-checks and runs Chromium scenarios: UI registration/login and Space creation, settings persistence after reload (name, visibility and Git default branch), organization/Space membership across accounts, commit history/diff browsing across branches, Git raw content and file downloads pinned to the displayed commit, whole-repository ZIP downloads with exact nested contents and Git export attributes, Object folder navigation with file upload, preview, download and deletion, Object version uploads, historical downloads, restoration and deleted-file recovery, batch/folder uploads and native directory drops beyond 100 files, partial failures and safe retries, stopping uploads and leaving a Space, file selection and batch deletion with version conflicts, cancellation, lost responses and write-permission changes, file renaming/moving with retained history and conflict handling, batch moves with path previews, partial failures, safe retries and cancellation, Media playback, seeking, photos and sharing, Ebook EPUB/PDF reading, and admin-only storage inspection. The tests use actual pages and HTTP requests; upload, deletion and move fault scenarios interrupt real requests or responses rather than supplying mocked API data. Git branches are seeded in isolated test repositories; `pnpm test:integration` continues to verify actual clone/push permissions and raw/ZIP streaming behavior.

The worker automatically starts its own Vite and backend servers on available local ports. It shares the integration suite's temporary schema, migration and storage setup; each worker gets a fresh environment and each test gets a fresh browser context. Existing dev servers are not reused or stopped. Servers, schema and temporary files are cleaned up even when an assertion fails. Tests run with one worker and no retries by default.

Failed tests keep screenshots and traces under `apps/web/test-results/`. The HTML report is under `apps/web/playwright-report/`; both directories are ignored by Git. Open the latest report with:

```powershell
pnpm --filter @enspatium/web exec playwright show-report
```

For a visible browser, run `pnpm --filter @enspatium/web exec playwright test --headed`. No browser login or saved authentication state from your development session is used. As with integration tests, force-killing the process may interrupt cleanup.

## Authentication

Start PostgreSQL and configure the root `.env` using `.env.example` (including `DATABASE_URL` and a random 32-byte hex `SESSION_KEY`). Apply migrations with `pnpm --filter @enspatium/server db:migrate`, then run `pnpm dev` and `pnpm --filter @enspatium/web dev` in separate terminals.

Open `/register` to create an account, then sign in at `/login`. Authentication uses the generated API client and the backend's HttpOnly session cookie. Refreshing the page restores the user through `/auth/me`; the profile URL uses the personal namespace returned by `/namespaces`. The user menu signs out through `/auth/logout`.

After signing in, use the navigation's Create menu to open `/space/create`. Owner choices come from the backend and include only namespaces you own. Creation supports Git repositories, object storage, Media and Ebook library, with private visibility by default. The URL name is editable and must contain 3–40 lowercase letters, numbers, or single hyphens.

Creation updates the account list and opens `/:account/:spaceSlug`. Account profiles, organization icons, Space lists, and Space details use real API data and survive reloads. Lists require namespace membership; public Space details can be opened without signing in. Run frontend tests with `pnpm --filter @enspatium/web test`.

Signed-in users can choose **Create organization** from the navigation menu to open `/organization/create`. Organizations use the same `/:account` profile route as personal accounts. Their owner can open the **Members** tab to add registered users by email or remove them with confirmation. Removing an organization member also removes their memberships in its Spaces. Reserved application URLs (including `login`, `settings`, and `organization`) cannot be used for new organizations.

In an organization's **Space settings → Members**, Space owners can add organization members as **Reader** or **Writer**, change their role, or remove their access. Readers can view/download and clone/fetch; writers can also push and manage Object files. Owners cannot be changed or removed through these controls. Membership does not grant access to every private Space automatically: add the user to the organization first, then to each Space they need. Personal Spaces do not support additional members. Public content remains readable after member removal. Git clients still need an access token with the appropriate Git scope, and permissions are checked on each request. Email invitations and group management are not included.

Object Spaces show files and folders with icons, grouping slash-separated object keys one level at a time. Use the breadcrumbs or **Back to parent folder** to navigate; the current path, filename filter and page cursor are stored in the URL. Folders appear before files, with up to 100 entries per page and **Next page** navigation. Grouping happens before pagination, so folders are not hidden by a large number of descendant files. Choose **Upload files**, **Upload folder**, or drop files and folders into the upload area. Uploads keep the outer folder name and nested paths under the current folder, with up to 100 MiB per file. Click a filename to open its details and preview. Text previews support up to 1 MiB and common raster images up to 10 MiB; HTML and SVG are shown as text. Other formats show file details with a download option. Use the separate download icon or the viewer's **Download** button to save a file. Uploads preserve file bytes and MIME types; uploading the same key creates a new version and preserves previous bytes. The backend enforces read/write permissions and storage quotas. File lists require sign-in; the filename-prefix filter applies within the current folder. **New folder** opens an empty path, which appears in its parent only after a file is uploaded. Empty folders are skipped and have no separate metadata records. File/folder name conflicts are rejected. Use **Delete file** in the preview and confirm to move one file to **Deleted files**, preserving all versions; parent folder lists and storage usage are refreshed. Closing the viewer cancels its preview request and releases image URLs; leaving a folder cancels its previews and downloads. Recursive folder deletion is not included.

Each upload selection starts a local queue with per-file status and a fixed destination; browsing another folder does not redirect queued uploads. Files upload one at a time through the existing API. **Retry** or **Retry remaining** resends only failed or stopped items, keeping the original version precondition. If the destination changed after an attempt, review its versions before selecting the file again; a lost response must not silently create another version. Successful files stay uploaded when another fails. **Stop uploads** cancels the active request and stops queued files; leaving the Space or signing out also stops the queue. A canceled request might already have committed, so retry checks its version first. Selecting another batch replaces the previous upload report; queues do not persist across reloads. Unsupported directory dragging shows a message to use the upload buttons. Media and Ebook file management use this same upload panel.

Select files with the row checkboxes or **Select all files on this page**, then choose **Delete selected** and review the filenames before confirming. Selection includes only files on the visible page; folders and their descendants are not selected. Changing the folder, filter, page or Files/Deleted files view clears selection and results, and stops pending deletions. Leaving the Space, signing out and reloading also stop the queue. **Stop deleting** keeps the report available for retry. Completed deletions remain in **Deleted files**, where retained content versions can be restored; their bytes continue to count toward storage usage until retention cleanup.

Batch deletion uses the existing API one file at a time and keeps the selected version as its precondition. Changed or restored files require review and a fresh selection. Failed or stopped items can be retried individually or with **Retry remaining**; already deleted items are recognized without another write, including after a lost response. Permission denial stops the remaining queue. Successful items are not retried or rolled back when another fails. The list, versions, usage and App lists refresh after processing. Upload, deletion and move controls prevent starting overlapping batches in the same view. Media and Ebook file management share this behavior. There is no recursive folder deletion, permanent batch purge, new endpoint or database table.

Open an active file's preview and choose **Rename** to change its filename, or **Move** to enter a destination folder within the same Space. A blank destination moves it to All files; nested and new folders are supported. The form shows the resulting path before saving. Successful moves refresh the source list and provide **Open destination folder**. Object IDs, content, version IDs, revision numbers, retention dates and storage usage are preserved. Historical versions remain downloadable and restorable at the new key. URLs containing the old key change; App links based on object IDs remain stable. Historical previews and deleted files cannot be renamed or moved from the UI.

**Move selected** moves the selected files on the current page to one folder in the same Space, keeping their filenames. Review each new path before confirming; a blank destination means All files. Files move one at a time through the existing move API. The results show successes and failures separately, with **Stop moving**, per-file **Retry**, and **Retry remaining moves**. Name conflicts never overwrite content; resolve the conflict before retrying, or select the source again to choose another destination. Changed source files require review and a fresh selection. Retries keep the original identity, source path, destination and version, including after a lost response. Permission denial stops the queue. Changing folders, filters, pages or views, leaving the Space, signing out or reloading stops pending moves; reports are local to the current view. Successful moves remain complete if another file fails. Recursive folder moves and cross-Space moves are not included.

`POST /namespaces/:namespaceSlug/spaces/:spaceSlug/object-move?objectId=...&key=...&newKey=...&expectedVersion=...` requires write access and checks the original identity, path and content version inside the same Space transaction lock used by other Object writes. Existing active files, folder conflicts and exact keys reserved by deleted files return `409 OBJECT_KEY_CONFLICT`; changed, moved or deleted sources return `409 OBJECT_MOVE_CONFLICT`. Retrying the same successful request returns the existing result without another audit event. The operation updates only the logical key and modification time, recording `object.moved` with old/new keys; version storage locators, including legacy nested paths, stay unchanged. No files are copied and no migration is required. OpenAPI and the generated client include the typed endpoint. Integration tests cover legacy paths, history, quotas, concurrent moves, permission checks and transaction rollback; browser tests cover the forms, conflicts, historical restore and lost-response retry. Cross-Space moves and recursive folder moves are outside this first version.

Git Spaces support read-only branch selection, folder navigation, text previews (up to 1 MiB), and a root README preview. Branch and path are stored in `ref`, `path`, and `view` query parameters. Opening a file also pins `commit` to the displayed tree's commit ID; branch-only file links resolve and save a commit ID when opened. Reloads, **Raw**, and **Download** keep that version even after someone pushes to the branch. Switching branches or returning to the file list opens the current branch view. Binary files are identified without displaying them as text. README Markdown uses safe React rendering with raw HTML omitted; images are shown as alt text and relative links as text. Creating commits, editing files, and creating/deleting branches remain outside the UI.

The file header offers **Raw** in a new tab and **Download** with the original filename. Binary files, empty files and files larger than the preview limit remain downloadable. Raw content is served as plain text with `nosniff` and a sandbox policy, so HTML/SVG source cannot execute as a page. Downloads use native browser transfers rather than buffering the whole file in frontend memory. The backend streams Git blob bytes without the preview size limit and terminates the content process when the client disconnects. Symlinks return their stored target text; directories and submodules cannot be downloaded as files.

`GET /namespaces/:namespaceSlug/spaces/:spaceSlug/git/file-info?ref=...&path=...` returns file metadata for any size. `GET /namespaces/:namespaceSlug/spaces/:spaceSlug/git/raw?ref=...&path=...` streams its content; add `download=true` for an attachment. HEAD returns the same headers without starting a content stream. Responses include `X-Git-Commit` and `Cache-Control: private, no-store`; every request rechecks Space read access. The existing `/git/file` JSON preview endpoint keeps its 1 MiB limit. OpenAPI and the generated client include these routes. Git raw byte ranges are not included. The Git file integration test covers exact bytes, Unicode filenames, commit/tag pinning, large files, symlinks, invalid paths, access revocation, HEAD and cancellation.

The **Commits** tab lists the selected branch's history in pages of 30, with author, timestamp and short SHA. Open a commit to see its full message, changed files, and a unified diff with line numbers and green/red additions/removals. Initial commits show added content; merge commits compare against their first parent. Renames, deletions, file mode changes and binary files are identified. The selected commit/file and history page are stored in the URL. Pagination stays pinned to a commit snapshot, so a concurrent push does not shift pages; **Latest commits** returns to the current branch tip. Diffs are limited to 1 MiB per response and 3,000 displayed lines per file, with an explicit message when a limit is reached. Commit text is rendered as text, including HTML-like content.

Space owners can open **Settings** at `/:account/:spaceSlug/settings` to edit the display name and public/private visibility while keeping the URL unchanged. Git settings select an existing default branch for browsing and future clones; empty repositories must receive their first push before a branch can be selected. The API enforces owner permissions and rejects missing branches, tags, and commit IDs. **Delete Space** is under **Danger zone**, with the existing URL-name confirmation.

Use **Clone** to copy the repository's HTTP(S) URL. Empty Git Spaces show a copyable push command for an existing local repository and **Refresh files** to load the first push. Git URLs use the same `/api` proxy as the frontend; Git authentication uses an access token as the password.

The same menu offers **Download ZIP** for repositories with commits. It downloads the whole source tree, including when browsing a subfolder, as `<space-slug>-<short-commit>.zip` with a matching root directory. File lists, file views and selected commits use their displayed commit; paginated history uses its snapshot, and the latest history view resolves the selected branch when requested. The download preserves nested paths and follows native Git archive behavior, including committed `export-ignore` and `export-subst` attributes. Symlinks contain their stored target; Git history, untracked files and submodule contents are not included.

`GET /namespaces/:namespaceSlug/spaces/:spaceSlug/git/archive?ref=...` checks Space read access, resolves the ref once (defaulting to HEAD), and streams `git archive --format=zip` directly to the browser. It returns `application/zip`, an attachment filename, `X-Git-Commit` and `Cache-Control: private, no-store`. HEAD validates access and the commit without starting ZIP generation. ZIP size is not known in advance, so Content-Length and byte ranges are not provided. Disconnects stop generation; there is no disk cache or new database table. The generated API client includes Blob types and a URL helper used for native browser downloads. The archive integration test verifies branch/tag/commit resolution, permission revocation, HEAD and cancellation; Playwright downloads and unpacks ZIPs to verify contents and version pinning.

Open **Access tokens** in the user menu or **Manage access tokens** in the Clone popup to visit `/settings/access-tokens`. Create a named token with read-only or read/write Git permissions and a 30-day (default), 90-day, or unlimited lifetime. Copy the full token when it is created; it is cleared when you select **Done**, leave the page, or sign out, and is never stored in application query caches or browser storage. The list shows permissions, status, expiration, and last use. Revocation requires an inline confirmation and immediately disables that token. Token scopes do not grant access beyond your existing Space permissions.

Missing Space storage returns `503 SPACE_STORAGE_UNAVAILABLE` instead of an empty listing; missing content for an existing Object record returns `404 OBJECT_CONTENT_MISSING`. Records are preserved, uploads do not recreate missing Space directories, and the UI supports retry after storage is restored. Space owners can use **Delete Space**, confirm its URL name, and remove the Space even if its directory is already missing, provided the storage root is accessible and unchanged. Deletion removes related Object/member records and preserves audit history.

Storage-root identity checks cover disappearance or replacement during the running server process. Deployment must ensure the correct `DATA_ROOT` volume is mounted before startup; these checks are not persistent volume identification or a backup/recovery system.

## Storage integrity inspection

Site administrators can call `POST /admin/storage/check` with their existing login session (`/api/admin/storage/check` through the frontend proxy). It returns a JSON report directly; no command-line checker or background job is needed.

Signed-in admins also have **Site administration** in the user menu, immediately above the Sign out divider. This opens `/settings/admin`, where they can run basic or deep checks for all Spaces or a single Space ID and review findings. Checks start only when requested. Login and session responses include the current `isAdmin` flag; public user profiles do not. The API rechecks the database role regardless of menu visibility.

Apply migration 0016 with `pnpm --filter @enspatium/server db:migrate`. It adds `users.is_admin`, defaulting to `false` for both existing and new accounts. Provision the first administrator through a trusted database connection using the registered account's ID:

```sql
UPDATE users SET is_admin = true WHERE id = '<registered-user-id>';
```

Registration cannot grant admin access. Space ownership and Git access tokens do not grant site administration rights. Every check reads the current database role, so revocation applies to existing sessions. Unauthenticated requests receive 401; signed-in non-admins receive 403. No existing account is automatically promoted.

Send `{}` for a basic check of all Spaces, or select a Space and verify its contents:

```json
{
  "spaceId": "00000000-0000-0000-0000-000000000001",
  "deep": true
}
```

Only the server's configured `DATA_ROOT` is inspected. Basic mode checks Space directories, Object current-version metadata, retained version locators and sizes, and Git bare-repository structure, refs and HEAD. Deep mode also streams Object bytes to compare SHA-256 and runs `git fsck --full --no-progress`, including packed objects. Basic success does not verify contents. Empty Git repositories are valid; dangling Git objects alone are informational.

Checks run while the service remains online. In the current single-backend deployment, a shared guard covers each storage mutation from before its first filesystem change through its database commit or rollback. If an upload, push, deletion, restore, branch change, Space creation or retention purge is active, checking returns `409 STORAGE_BUSY`. While checking, another check and new storage writes also receive 409. Downloads, browsing, clone and login remain available; scheduled retention skips that sweep and retries on its next interval. Push-triggered automatic Git maintenance is disabled so it cannot outlive the write guard. Even a single-Space check pauses writes across the same data root to keep coordination simple.

The scan has a two-minute cooperative time budget, a 30-second limit per database statement, and a 60-second limit per Git command with bounded output. Cancellation returns an incomplete report after cleanup, then releases the write guard. For larger installations, check one Space at a time and allow enough time in the HTTP proxy. A stalled filesystem or database connection can delay cancellation; this is not a background job API.

HTTP 200 reports have `status: "ok" | "issues" | "incomplete"`, `complete`, timestamps, mode, scope, Space counts and issues with Object keys, version IDs and physical paths. `issues` means findings need attention; `incomplete` means the scan could not finish. Version byte totals are decimal strings and do not represent disk allocation or unknown files. Responses use `Cache-Control: private, no-store`. Invalid UUIDs or field types receive 400; concurrent storage operations receive 409. The endpoint and typed client are included in OpenAPI and generated `admin.ts`; regenerate with `pnpm generate:api`.

All retained Object versions are checked, including deleted-file history and legacy nested paths. Deletion markers require no content file. Pending purges produce `PURGE_PENDING`; missing bytes are expected until metadata cleanup completes. Unreferenced files, temporary uploads and unregistered root entries are reported separately. Unknown root entries are not recursively inspected; a scoped check omits them. Empty Object folders have no database records and are not orphan content.

Inspection uses a read-only repeatable-read transaction. It does not initialize missing storage, repair records, change checksums, import files or remove anything. Detected external changes, inaccessible paths, symlinks/junctions and special files make the report incomplete. Git external object stores, common directories, config includes and custom fsck overrides require manual review.

The write guard coordinates only this backend process. Direct filesystem edits, direct database edits and another backend process bypass it; it is not a distributed lock or a database/filesystem snapshot. Keep `DATA_ROOT` writable only by the service account and perform ordinary changes through Object APIs or Git push. A structurally valid manual Git change may pass inspection. Recover lost bytes from backup or restore an intact retained Object version through the normal API. Changing a stored file does not create a version, and adding a file directly does not register an Object. Inspection preserves metadata for recovery; it never updates checksums to legitimize changed bytes.

Integration tests verify admin enforcement and revocation, concurrent uploads/checks/retention, reads during checks, missing/renamed files, same-size corruption, interrupted cleanup, pagination, legacy paths, packed and empty Git repositories, dangling and corrupt objects, invalid HEAD/refs and symlinks. They compare database records and file contents before and after inspection using isolated schemas and temporary storage.

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

## Media Spaces

Choose **Media** on `/space/create` to create an Object Space with `app: media`. Git and ordinary Object Spaces keep `app: null`. Media uses the same storage, permissions, quota, version history and retention settings as Files; there is no second Space or media database.

Apply migrations through 0015 before starting the updated backend:

```powershell
pnpm --filter @enspatium/server db:migrate
```

Ordinary Object and Git Spaces keep their current interface. Changing an existing Space's app is not included. The database and API both reject Media on Git Spaces.

The player has its own route, `/app/media/:spaceId`, outside the main application layout. App URLs follow `/app/<app type>/<space ID>`; the globally unique ID avoids collisions between accounts with identically named Spaces. `GET /apps/:appType/spaces/:spaceId` resolves the library using its existing access rules. `app` is reserved when creating organization URLs. The player shows the library name, **All / Music / Videos / Photos**, filename search, pagination and playback. It has no platform navigation, upload controls, Space settings or storage details. Share this URL with listeners and viewers; private libraries offer sign-in and return to the player after login. Music and videos use native browser controls with no autoplay; selecting another item or leaving the player stops the previous source. Photos support previous/next within the current page and download, retaining the 10 MiB preview limit.

Creating or clicking a Media Space opens `/:account/:spaceSlug` in the same tab, just like an ordinary Object Space. This page manages files and contains no player. Its **Open app** button opens the independent player in a new tab. Uploads, folders, versions, deletion, restoration and settings stay in the main application. The former `?view=files` switch is no longer needed. An open player refreshes on focus, every 30 seconds, or immediately via Reload, so it can pick up changes from the management tab. Migration 0013 adds the App registry and preserves existing Media Spaces.

Standalone applications live in [App Pages](apps/web/src/pages/AppPages/README.md). The `app_types` table records each globally unique type, name, kind (`builtin` or `custom`), optional creator and supported storage type. `spaces.app_type` references this registry; a composite foreign key also enforces storage compatibility. Migration 0013 registers Media as built-in without changing existing Space IDs or files. Adding app types no longer requires changing a Media-only API enum or database check.

`GET /apps` lists built-in apps and the signed-in user's own custom app records. Creating a Space requires a registered, compatible app; custom apps are currently usable for creation only by their creator. `GET /apps/:appType/spaces/:spaceId` resolves any registered App Space using its existing read permissions. All Object App types share list, detail and streaming routes under `/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType`. A local frontend plugin supplies the `view` and `integration`; creation options include only backend records with an available compatible frontend plugin. Unknown frontend plugins show **App not available**. Media and Ebook library are provided today. Self-service registration, plugin uploads, remote execution and a marketplace are future work.

`GET /namespaces/:namespaceSlug/spaces/:spaceSlug/media` filters current, non-deleted media before pagination. Audio/video MIME types and supported raster image MIME types are included; HTML/SVG and unclassified files stay in Files. Content types do not guarantee decodability: unsupported or damaged media shows an error with Reload and Download options. There is no transcoding, server-side thumbnail generation, playlist service or background playback.

The version-pinned `/media/content?key=...&versionId=...` endpoint supports GET, HEAD and Range. A public visitor can only read the current active version; an updated/deleted old version becomes inaccessible to that visitor. Authorized signed-in readers can use retained history. Private Spaces require access on every list and content request. Responses use `private, no-store`; the active list refreshes every 30 seconds and on window focus, and Reload checks immediately. Already downloaded bytes cannot be revoked. The existing Object version endpoint still requires sign-in.

Vitest integration tests cover app validation, filtering beyond 100 ordinary files, pagination, literal searches, member permissions, versions and storage errors. The Media Playwright flow uploads synthetic MP3, H.264/AAC MP4, VP9 WebM and PNG fixtures from file management, opens the independent player in a new tab, checks playback/seek and cleanup, downloads photos, and checks public/private access and sign-in return URLs. It also verifies that card clicks stay in file management, only Open app launches a new tab, and ordinary Spaces have no player. Fixture files are included; FFmpeg is not a runtime or test dependency.

## Ebook library Spaces

Choose **Ebook library (built-in)** on `/space/create`, upload EPUB or PDF files in the Space, then use **Open app** to open `/app/ebook/:spaceId`. The library has filename-based book covers, EPUB/PDF filters, search and pagination. Selecting a book opens `/app/ebook/:spaceId/book/:bookId` as a separate reading page. Book URLs support direct links, refresh and sign-in return. EPUB supports chapter selection and text size; PDF supports page navigation and zoom. **Back to library** restores the shelf's filters and page, and **Download book** saves the original file.

App plugins declare optional relative subroutes in their `routes` configuration, appended to `/app/<app type>/<space ID>`. The shared App Pages host handles matching, authorization and unknown-page errors. Adding a plugin page does not require changes to the main frontend router; see the [plugin subroute guide](apps/web/src/pages/AppPages/README.md#plugin-subroutes).

Migration 0014 registers this built-in plugin; run `pnpm --filter @enspatium/server db:migrate`. No new environment variables or storage setup are needed. EPUB previews support unencrypted files up to 20 MiB with bounded archive extraction and sanitized chapters. PDF previews use a bundled PDF.js worker. Advanced EPUB layouts, reading progress, bookmarks and metadata editing are not included. See the [App Pages guide](apps/web/src/pages/AppPages/README.md) for limits and plugin structure.

Books use existing Object versions, quotas, retention and Space permissions. Public visitors can read only current active versions. Upload a replacement in Files, then reload the library to read the latest version. Integration tests cover filtering, pagination, permissions and versioned streaming; Playwright uploads actual EPUB/PDF fixtures and verifies chapters, safe rendering, PDF pages, mobile layout and public/private access.

## Shared App backend

Migration 0015 preserves the App registry and Spaces while renaming the tables/columns to `app_types` and `spaces.app_type`. The public Space API still uses `app`. Media and Ebook now share one set of list, item and content routes parameterized by `appType`; Ebook uses `/ebook` instead of `/ebooks`. Each local backend plugin declares its supported MIME types and kinds. Adding another Object App requires registration and a plugin definition, without adding routes, tables or API enums. See the [backend App guide](packages/server/src/apps/README.md) for the contract, reserved route names and extension steps.

## Object streaming

Both the current-content URL (`/namespaces/:namespaceSlug/spaces/:spaceSlug/objects/:objectKey`) and the version-content URL (`/namespaces/:namespaceSlug/spaces/:spaceSlug/object-versions/content?key=...&versionId=...`) support GET and HEAD. No new configuration or migration is required for streaming.

- GET supports a single byte range: `bytes=0-1023`, `bytes=1024-`, or `bytes=-1024`. It streams only those bytes from disk and returns `206`, `Content-Range`, `Content-Length`, and `Accept-Ranges: bytes`.
- A valid but unsatisfiable range returns an empty `416` with `Content-Range: bytes */size`. Requests without Range, unsupported units, malformed ranges and multiple ranges return full content with `200`.
- HEAD returns the full content's headers without creating a file read stream; it ignores Range.
- `If-Range` accepts the exact strong ETag returned by the server. A mismatch, weak tag or HTTP-date returns full content with `200`. The server does not publish Last-Modified because separate revisions can share the same second. `X-Content-SHA256` always describes the entire object, including on partial responses.
- Every request checks permissions and version availability before disclosing content metadata. Public current content permits anonymous reads; the version-content endpoint still requires sign-in. Responses use `Cache-Control: private, no-store`. Disconnecting closes the file stream. Missing content/storage retains the existing errors; a stored size mismatch returns `409 OBJECT_CONTENT_CORRUPT`.

Use a version-pinned content URL as the audio/video element's `src` to keep successive ranges on the same immutable revision. Let the browser stream from that same-origin URL with session cookies; the generated Blob download functions are for explicit downloads. Media uses `/media/content` to also support public current-version reads. Range API behavior is covered by the Vitest integration suite, including a real socket cancellation; the protocol follows [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-14).

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
