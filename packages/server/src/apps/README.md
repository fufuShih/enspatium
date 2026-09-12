# App types and Object App plugins

An App type is a registered way to present a Space. A Space keeps its storage type (`git` or `object`) and optionally references one App type. Media, Ebook and Note use Object storage, sharing data, permissions, versions, retention and quota with file management.

## Database

Migration 0015 renames `apps` to `app_types` and `spaces.app` to `spaces.app_type`, preserving rows and IDs. The registry has:

| Column | Purpose |
| --- | --- |
| `type` | Globally unique string used in URLs, such as `media` or `ebook` |
| `name` | Display name |
| `kind` | `builtin` or `custom` |
| `owner_user_id` | Required only for custom registrations |
| `storage_type` | Supported Space storage type |
| `created_at` | Registration time |

`spaces(app_type, type)` references `app_types(type, storage_type)`. A Space cannot reference an unknown or incompatible App type. This is one optional reference per Space, with no per-app tables, duplicated book/media records or database enum for App names. The public Space API retains its `app` field for compatibility; it maps to `app_type` internally.

App URLs share the Space resource prefix. The database reserves `git`, `object`, `objects`, `members`, `storage`, `object-tree`, `object-head`, `object-versions` and `audit-events` so registrations cannot shadow existing routes. New platform resources at that prefix must also be reserved before use. A migration fails rather than silently renaming a conflicting existing custom type.

## Shared routes

| Method | Route | Result |
| --- | --- | --- |
| GET | `/apps` | Built-ins and the signed-in user's custom registrations |
| GET | `/apps/:appType/spaces/:spaceId` | Resolve a frontend App Page with Space access checks |
| GET | `/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType` | `{ objects, canUpload, nextCursor }` |
| GET | `/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType/:itemId` | Current Object metadata plus `kind` |
| GET / HEAD | `/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType/content?key=...&versionId=...` | Version-pinned content with Range support |

Lists accept `kind`, `search`, `cursor` and `limit`. `kind` is a string validated against the selected plugin's kinds, so adding an App or kind does not require another OpenAPI enum. All other metadata uses the existing Object schema. Generated clients live in `apps.ts` and `app-objects.ts`.

The routes and `services/app-objects.ts` own permissions, Space/App matching, filtering before pagination, lookups scoped to a Space and streaming. Both list/detail and content must match the plugin's formats. Public visitors can only read current active versions; authenticated authorized readers can read retained versions. Every content request rechecks permissions. Unknown, unavailable or mismatched plugins return 404. Uploads and other mutations remain in the existing Object APIs.

## Add an App using Object storage

1. Register its metadata in `app_types` using a migration. Custom types require an owner; only that owner can create Spaces with them.
2. Add a local module under `plugins/` and include it in `objectAppPlugins` in `registry.ts`.
3. Add the corresponding frontend plugin. Its integration can use `createObjectAppIntegration(type)` and its views can declare relative subroutes.

For example, a future document app can describe its accepted files without adding HTTP handlers or SQL queries:

```ts
export const documentPlugin = {
  type: 'documents',
  storageType: 'object',
  kinds: [
    { kind: 'markdown', contentTypes: ['text/markdown'], extensions: ['md'], contentType: 'text/markdown' },
  ],
} satisfies ObjectAppPlugin
```

Rules are evaluated in order. `contentTypes` contains lowercase exact MIME types or a top-level wildcard such as `audio/*`. `extensions` contains lowercase suffixes without dots and defaults to matching `application/octet-stream` uploads. Optional `extensionContentTypes` overrides those fallback MIME types; Note also accepts `.md`/`.markdown` uploaded as `text/plain`. Optional `contentType` sets the canonical streaming MIME type. The same rules generate the SQL filter and classify downloaded versions.

Media, Ebook and Note are implemented. Note is registered by migration 0018; it saves Markdown through the existing Object upload API with `expectedVersion` rather than adding note-specific write routes or tables. DB registration does not load code, and plugins are deployed TypeScript modules. There is no runtime code upload, self-service registration UI, plugin marketplace or arbitrary JSON configuration layer.
