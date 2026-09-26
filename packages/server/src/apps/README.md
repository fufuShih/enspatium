# App types and Object App plugins

An App type is a registered way to present a Space. A Space keeps its storage type (`git` or `object`) and can own multiple App instances, including several of the same type. Media, Ebook and Note use Object storage, sharing data, permissions, versions, retention and quota with file management.

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

Migration 0020 adds `space_apps`: an independent UUID, owning `space_id`, registered `app_type`, name, plugin-validated JSON config, typed PWA settings and timestamps. An internal `storage_type` discriminator participates in composite foreign keys to both Space and App type, rejecting unknown or incompatible types even on direct database writes. There is no unique `(space_id, app_type)` constraint. Instance identity and type are immutable.

Each existing `spaces.app_type` becomes one instance whose UUID equals its Space UUID, preserving old bookmarks and timestamps. New instances get independent UUIDs. Spaces without an App remain unchanged. The public Space API retains its `app` field and `spaces.app_type` as a compatibility reference; creating a Space through that API also creates its original instance atomically. Other instances never replace that reference.

`services/app-instances.ts` provides list/resolve/create/update/delete operations. Reads reuse Space visibility and membership; management reuses Space-owner access (including namespace owners). Custom registrations remain restricted to their creator for instance creation. Removing the original instance clears the legacy reference without choosing a replacement; deleting any instance leaves content, versions, permissions and quota intact. Space deletion cascades to its instances. App creation, updates and removal commit atomically with `app.created`, `app.updated` and `app.deleted` audit events; config contents are not logged.

Names default to the Space name at creation and can subsequently differ. Config is limited to 16 KiB of JSON and validated against the deployed plugin's optional TypeBox `configSchema`; without a schema, only `{}` is accepted. Built-ins currently have no configurable options. The database has an additional 32 KiB serialized-JSON ceiling to allow PostgreSQL's whitespace formatting. PWA settings default to `{ enabled: false, iconObjectId: null, themeColor: null, offlinePolicy: 'shell' }`; a null color inherits the platform theme. This data layer does not yet expose PWA setting changes, manifests, service workers or installation.

App URLs share the Space resource prefix. The database reserves `git`, `object`, `objects`, `members`, `storage`, `object-tree`, `object-head`, `object-versions`, `audit-events` and `apps` so registrations cannot shadow existing routes. Migration 0021 adds `apps` for the management API. If a deployment already registered that type, migration rolls back without changing its data; an operator must resolve the conflicting registration and its references before retrying. New platform resources at that prefix must also be reserved before use.

## Shared routes

| Method | Route | Result |
| --- | --- | --- |
| GET | `/apps` | Built-ins and the signed-in user's custom registrations |
| GET | `/namespaces/:namespaceSlug/spaces/:spaceSlug/apps` | `{ apps, canManage }`, including independent IDs, names and types |
| POST | `/namespaces/:namespaceSlug/spaces/:spaceSlug/apps` | Create an instance with `{ appType, name? }`; omitted name defaults to the Space name |
| PATCH | `/namespaces/:namespaceSlug/spaces/:spaceSlug/apps/:appId` | Rename with `{ name }`; ID, type and owning Space stay fixed |
| DELETE | `/namespaces/:namespaceSlug/spaces/:spaceSlug/apps/:appId` | Remove only that instance; 204 with no body |
| GET | `/apps/:appType/instances/:appId` | Instance ID/name/config/PWA defaults, explicit `spaceId`, Space account/slug and App type metadata |
| GET | `/apps/:appType/instances/:appId/objects` | Instance-scoped `{ objects, canUpload, nextCursor }` |
| GET | `/apps/:appType/instances/:appId/objects/:itemId` | Current Object metadata plus `kind` |
| GET / HEAD | `/apps/:appType/instances/:appId/objects/content?key=...&versionId=...` | Version-pinned content with Range support |
| GET | `/apps/:appType/spaces/:spaceId` | Compatibility loader for the original instance only |
| GET | `/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType` | `{ objects, canUpload, nextCursor }` |
| GET | `/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType/:itemId` | Current Object metadata plus `kind` |
| GET / HEAD | `/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType/content?key=...&versionId=...` | Version-pinned content with Range support |

Object lists accept `kind`, `search`, `cursor` and `limit`. `kind` is a string validated against the selected plugin's kinds, so adding an App or kind does not require another OpenAPI enum. All other Object metadata uses the existing Object schema. Generated clients live in `apps.ts`, `app-objects.ts` and `space-apps.ts`. Management routes are private/no-store and accept only type/name on creation or name on update; config and PWA settings are not public mutations yet.

Frontend App Pages use `/app/:appType/:appId/` and the instance endpoints. The server resolves the owning Space from `space_apps`, never from a client-supplied Space ID. Legacy namespace content routes also require the original instance; deleting it does not redirect old URLs to another App. Existing bookmarks (including roots without a trailing slash and book/note child routes) keep working because migrated instances retained their UUIDs. Metadata is private/no-store; streams preserve the existing Object cache, Range and HEAD rules.

The routes and `services/app-objects.ts` own permissions, Space/App matching, filtering before pagination, lookups scoped to a Space and streaming. Both list/detail and content must match the plugin's formats. Public visitors can only read current active versions; authenticated authorized readers can read retained versions. Every content request rechecks permissions. Unknown, unavailable or mismatched plugins return 404. Uploads and other mutations remain in the existing Object APIs.

## Add an App using Object storage

1. Register its metadata in `app_types` using a migration. Custom types require an owner; only that owner can create instances or legacy Spaces with them.
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
