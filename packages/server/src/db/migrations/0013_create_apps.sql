CREATE TABLE apps (
  type text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('builtin', 'custom')),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  storage_type space_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apps_type_format CHECK (length(type) BETWEEN 3 AND 60 AND type ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT apps_owner_check CHECK (
    (kind = 'builtin' AND owner_user_id IS NULL) OR
    (kind = 'custom' AND owner_user_id IS NOT NULL)
  ),
  UNIQUE (type, storage_type)
);

INSERT INTO apps (type, name, kind, storage_type) VALUES ('media', 'Media', 'builtin', 'object');

-- Preserve existing Media Spaces while replacing the hard-coded app constraint.
ALTER TABLE spaces DROP CONSTRAINT spaces_app_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_app_storage_fk
  FOREIGN KEY (app, type) REFERENCES apps(type, storage_type) ON DELETE RESTRICT;
CREATE INDEX apps_owner_index ON apps(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX spaces_app_index ON spaces(app) WHERE app IS NOT NULL;
