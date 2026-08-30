CREATE TYPE space_type AS ENUM (
  'git',
  'object'
);

CREATE TYPE space_visibility AS ENUM (
  'public',
  'private'
);

CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  namespace_id uuid NOT NULL
    REFERENCES namespaces(id)
    ON DELETE CASCADE,

  created_by_user_id uuid
    REFERENCES users(id)
    ON DELETE SET NULL,

  name text NOT NULL,
  slug text NOT NULL,
  type space_type NOT NULL,
  visibility space_visibility NOT NULL DEFAULT 'private',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT spaces_name_not_empty
    CHECK (length(trim(name)) > 0),

  CONSTRAINT spaces_slug_length
    CHECK (length(slug) BETWEEN 3 AND 40),

  CONSTRAINT spaces_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  CONSTRAINT spaces_namespace_slug_unique
    UNIQUE (namespace_id, slug)
);

CREATE INDEX spaces_namespace_id_index
ON spaces (namespace_id);