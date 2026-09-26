# App Pages

App Pages render an App instance at `/app/<app type>/<app ID>/`. Each instance explicitly resolves its owning Space, and multiple instances can share that Space's content.
Space cards still open file management. The Space's **Apps** panel lists every instance; each **Open app** action opens that instance in a new tab. Owners can create, rename and remove instances, including multiple of the same type. Renaming preserves its URL; removal requires confirmation and keeps files, versions, permissions and other apps. Readers can only open apps. Owners enable PWA metadata and configure the name, icon and theme color under **Space Settings → App installation settings**, acknowledging that installation metadata is public.

- `AppPage.tsx` handles the session, instance loading, document title, loading/errors and sign-in return URL.
- `AppPwaRuntime.tsx` updates installation metadata during client-side navigation and registers a network-only worker scoped to that App. Initial HTML already contains the manifest link. Disabled/deleted Apps remove only their own registration; leaving an App removes its document metadata without uninstalling its worker. Offline shells and installation guidance are not implemented yet.
- `types.ts` defines the small plugin contract and the generated `instance` prop passed to pages.
- `registry.ts` lists installed frontend views. The `/app/:appType/:appId/*` route resolves them here; unknown types show App not available. Creation options intersect these views with the backend App registry.
- `../SpacesPage/apps/` owns the management panel and dialogs, using the generated `space-apps.ts` client. Creation also checks storage compatibility; uninstalled views remain listed but cannot be opened. Changes refresh Space and instance metadata, with controls rechecked against the server's `canManage` permission.
- `plugins/media/index.ts` configures the built-in Media plugin.
- `plugins/media/MediaPage.tsx` is its view; `integration.ts` connects instance loading, media lists and streaming to the generated APIs.

Media follows the site's light/dark theme, with category navigation on the left and thumbnail cards on the right. Mobile categories become a horizontal row. Selecting a card expands a player above the grid without entering fullscreen; Close or Escape stops playback and returns focus to the card. Photos load lazily, nearby video cards request a browser preview, and music uses a cover icon. Missing previews fall back to type icons. `MediaThumbnail.tsx` and `MediaPlayer.tsx` keep preview and playback behavior separate.

Plugins are local TypeScript/React modules built with the frontend. A plugin declares `type`, `label`, `builtIn`, `view` and `integration`. Creation offers **Media (built-in)**, **Ebook library (built-in)** and **Note (built-in)**.

`view` is the React page at the app's root URL. Every view receives `{ instance, basePath }` and uses Chakra UI. `instance.id` is the App UUID; `instance.spaceId` is the owning Space UUID. The instance also includes its name, config/PWA settings, App type metadata and resolved Space account/slug. `integration` declares the storage type and `loadInstance(appId, signal)`, plus plugin-specific API functions. The loader receives an AbortSignal and uses the authorized instance API. These are developer settings in code.

```ts
export const mediaPlugin = {
  type: 'media',
  label: 'Media',
  builtIn: true,
  view: lazy(() => import('./MediaPage')),
  integration: mediaIntegration,
} satisfies AppPagePlugin
```

To customize Media, edit its view or integration. To add an app, create its folder under `plugins/` and add its definition to `appPlugins`; custom plugins set `builtIn: false`. Use `lazy(() => import('./YourPage'))` at module scope to load the page only when opened.

## Plugin subroutes

Plugins can declare optional `routes` alongside their root `view`. Paths are relative to `/app/<app type>/<app ID>/` and can contain parameters or more segments. The host handles route matching, shared Space authorization and an app-local **Page not found** fallback; plugins do not need entries in the site's main router. Media still uses just its root view.

```ts
export const ebookPlugin = {
  type: 'ebook',
  label: 'Ebook library',
  builtIn: true,
  view: lazy(() => import('./EbookPage')),
  routes: [{ path: 'book/:bookId', view: lazy(() => import('./BookPage')) }],
  integration: ebookIntegration,
} satisfies AppPagePlugin
```

Child views use React Router's `useParams()` for their parameters and receive the same `instance` and `basePath` props. `appPath('ebook', instance.id, 'book', book.id)` builds a URL by encoding and appending individual segments. Root links include a trailing slash; bookmarks without it remain supported. A future plugin may declare a deeper path such as `book/:bookId/notes` the same way. Use actual links for navigation so URLs support browser history, refresh and opening in another tab. Sign-in preserves the child URL and query.

The backend `app_types` table owns registration metadata: `type` (unique slug), `name`, `kind` (`builtin` or `custom`), `owner_user_id` and `storage_type`. `space_apps` owns instance identities/settings, with storage-compatible references to Space and App type. `spaces.app_type` is only the temporary compatibility reference. Media is seeded by migration 0013; a new app type requires a registry record, not another app enum or per-app route. The frontend plugin's label/builtIn fields describe bundled code; creation options use the backend name and kind.

`GET /apps` lists built-ins and the current user's custom records. `GET /apps/:appType/instances/:appId` is the common authorized instance loader. Integrations use `createObjectAppIntegration(type)` to bind this loader and the instance Object list/detail/content APIs. Each content request resolves the instance server-side and rechecks Space access; it never trusts a client-supplied Space ID. Query keys include the App ID and current user. List-query metadata lets ordinary file mutations refresh every mounted instance list for the same Space. Custom app creators can create Spaces with their app; viewing instances follows normal Space permissions. A registry record does not install a view: add its local plugin to `appPlugins` as well.

Migration 0020 converts each old Space App reference into an instance with the original UUID, preserving old bookmarks and child routes. New instances have independent UUIDs. The old `/apps/:appType/spaces/:spaceId` loader and namespace content routes only resolve the original instance; removing it never selects another instance. Server-side plugins declare format rules and share the generic Object App routes; see the [backend App guide](../../../../../packages/server/src/apps/README.md).

Registration currently happens through deployment migrations. A self-service registration endpoint/UI and plugin upload/execution are future work. Static pages and wiki are future examples.

## Note

Migration 0018 registers `note`. `/app/note/:appId/` opens a folder sidebar; `/app/note/:appId/note/:noteId` opens a Markdown note. Notes are ordinary `.md` Objects with existing permissions, versions and retention. Create notes inside folders with names such as `Journal/Today`. The note actions menu supports rename, move and confirmed deletion after saving any pending edits. Rename/move preserve the note URL and history; deletion returns to the same instance's list. All mutations use the resolved Space's ordinary Object API and check the opened version. Deleted notes can be restored through Files until retention cleanup removes their content.

The CodeMirror editor uses a single live-preview surface: the selected line shows Markdown syntax, while other lines format headings, emphasis, lists, quotes, code and links. HTML is displayed as text; unsupported Markdown remains editable source. Nothing is converted to HTML for storage. Explicit Save or Ctrl/Cmd+S checks the opened version; conflicts retain the draft and offer a download. Navigation warns about unsaved changes. Public readers cannot edit. Notes must be UTF-8 and at most 1 MiB; larger files remain available through Files. Advanced Obsidian features, embedded media, table layouts and wiki links are outside this first version.

## Ebook library

Migration 0014 registers `ebook`, using Object storage. `plugins/ebook` supplies the standalone `/app/ebook/:appId/` library, with format filters, filename search and pagination. Book links open a separate `/app/ebook/:appId/book/:bookId` reading page. **Back to library** preserves the shelf filters and page when opened from the shelf; a shared book URL returns to the complete library. Book covers are filename-based artwork; embedded cover extraction and metadata editing are not included. Uploads and version management stay in the ordinary Space page.

The generated `app-objects.ts` client connects to `/apps/:appType/instances/:appId/objects`, its `/:itemId` endpoint and version-pinned `/content?key=...&versionId=...` stream. Ebook binds `appType` to `ebook`, uses `kind=epub` or `kind=pdf` for filtering, and reads the returned `kind` field. `bookId` is the stable Object ID; the single-book endpoint resolves the current book within the authorized Space independently of list pagination. Replacing a file keeps its book URL, while deletion or an unsupported replacement makes the reading page unavailable. EPUB/PDF MIME types are recognized, with extension fallback for `application/octet-stream`. Filtering happens before pagination. Every metadata/content request checks Space access; public visitors can only read the active current version. Reload, focus and a 30-second refresh update the library and reading page.

EPUB is a chapter-based reader with a chapter selector and adjustable text size. ZIP extraction runs in a disposable worker with a 15-second timeout, a 20 MiB compressed limit, 50 MiB expanded limit, 10 MiB entry limit and 1,000-entry limit. XML/chapter text is capped at 2 MiB. Chapters use sanitized markup inside an opaque-origin sandboxed iframe with a restrictive CSP. Author scripts, styles, forms, external resources and navigation are removed; only local raster images up to 2 MiB are embedded. Original typography, advanced fixed layouts, encrypted books, hyperlinks, reading progress and bookmarks are not supported in this first version.

PDF.js loads only when a PDF is opened and uses its own bundled worker. Vite serves/copies its CMaps, standard fonts, ICC profiles and WASM decoders under `/pdfjs/`, so production and development use the same local assets without a CDN. It provides page previews, previous/next and zoom with canvas cleanup when switching books. Password-protected or damaged PDFs show an error and keep the download option. Canvas previews do not provide selectable text; download the original for full accessibility. No external reader service or additional server configuration is required.
