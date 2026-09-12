-- App registrations describe types; a Space is an instance of one registered type.
ALTER TABLE apps RENAME TO app_types;
ALTER TABLE spaces RENAME COLUMN app TO app_type;
ALTER TABLE spaces RENAME CONSTRAINT spaces_app_storage_fk TO spaces_app_type_storage_fk;
ALTER INDEX spaces_app_index RENAME TO spaces_app_type_index;
ALTER INDEX apps_owner_index RENAME TO app_types_owner_index;

-- App URLs share the Space resource prefix. Existing resource names must stay unambiguous.
ALTER TABLE app_types ADD CONSTRAINT app_types_reserved_routes CHECK (
  type NOT IN ('git', 'object', 'objects', 'members', 'storage', 'object-tree',
    'object-head', 'object-versions', 'audit-events')
);
