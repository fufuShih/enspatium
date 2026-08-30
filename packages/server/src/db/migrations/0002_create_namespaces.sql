CREATE TYPE namespace_kind AS ENUM (
    'personal',
    'organization'
);

CREATE TABLE namespaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    kind namespace_kind NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT namespaces_name_not_empty
        CHECK (length(trim(name)) > 0),

    CONSTRAINT namespaces_slug_length
        CHECK (length(slug) BETWEEN 3 AND 40),

    CONSTRAINT namespaces_slug_format
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE UNIQUE INDEX namespaces_one_personal_per_owner
ON namespaces (owner_user_id)
WHERE kind = 'personal';

-- Create personal namespaces for users who already exist before the migration
INSERT INTO namespaces (
    owner_user_id,
    name,
    slug,
    kind
)
SELECT
    id,
    display_name,
    'u-' || replace(id::text, '-', ''),
    'personal'
FROM users;