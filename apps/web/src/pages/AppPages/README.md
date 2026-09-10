# App Pages

App Pages render a Space as a standalone application at `/app/<app type>/<space ID>`.
Space cards still open file management; **Open app** opens an App Page in a new tab.

- `AppPage.tsx` handles the session, Space loading, document title, loading/errors and sign-in return URL.
- `types.ts` defines the small plugin contract and the `space` prop passed to pages.
- `registry.ts` lists installed frontend views. The `/app/:appType/:spaceId` route resolves them here; unknown types show App not available. Creation options intersect these views with the backend App registry.
- `plugins/media/index.ts` configures the built-in Media plugin.
- `plugins/media/MediaPage.tsx` is its view; `integration.ts` connects Space loading, media lists and streaming to the generated APIs.

Media uses a dark library layout with category navigation on the left and thumbnail cards on the right. Mobile categories become a horizontal row. Selecting a card expands a player above the grid without entering fullscreen; Close or Escape stops playback and returns focus to the card. Photos load lazily, nearby video cards request a browser preview, and music uses a cover icon. Missing previews fall back to type icons. `MediaThumbnail.tsx` and `MediaPlayer.tsx` keep preview and playback behavior separate.

Plugins are local TypeScript/React modules built with the frontend. A plugin declares `type`, `label`, `builtIn`, `view` and `integration`. Media is currently the only built-in plugin and appears as **Media (built-in)** when creating a Space.

`view` is the React page. It receives `{ space: { id, name, account, slug } }` and uses Chakra UI. `integration` declares the storage type and Space loader, plus any plugin-specific API functions needed by the view. The loader receives an AbortSignal and must use an API that checks Space access. These are developer settings in code.

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

The backend `apps` table owns registration metadata: `type` (unique slug), `name`, `kind` (`builtin` or `custom`), `owner_user_id` and `storage_type`. Only custom records have an owner. `spaces.app` references a registered type, and the database enforces matching storage types. Media is seeded by migration 0013; a new app type requires a registry record, not another app enum or per-app route. The frontend manifest's label/builtIn fields describe the bundled plugin; creation options use the backend name and kind.

`GET /apps` lists built-ins and the current user's custom records. `GET /apps/:appType/spaces/:spaceId` is the common authorized Space loader. Media's integration calls this loader and its own media list/streaming APIs. Custom app creators can create Spaces with their app; viewing an existing Space follows normal Space permissions. A registry record does not install a view: add its local plugin to `appPlugins` as well. Only the `app` URL prefix is reserved, so new plugin names do not compete with account routes.

Registration currently happens through deployment migrations. A self-service registration endpoint/UI and plugin upload/execution are future work. Only Media is implemented; static pages, wiki and ebook libraries are future examples.
