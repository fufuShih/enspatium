-- /namespaces/:namespaceSlug/spaces/:spaceSlug/apps is a platform resource.
-- Refuse a conflicting custom registration instead of silently changing its URL.
ALTER TABLE app_types DROP CONSTRAINT app_types_reserved_routes;
ALTER TABLE app_types ADD CONSTRAINT app_types_reserved_routes CHECK (
  type NOT IN ('git', 'object', 'objects', 'members', 'storage', 'object-tree',
    'object-head', 'object-versions', 'audit-events', 'apps')
);
