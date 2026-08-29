CREATE TYPE namespace_kind AS ENUM (
    'personal',
    'organization'
);

CREATE TABLE namespaces (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    kind namespace_kind NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX namespaces_one_personal_per_owner
ON namespaces (owner_user_id)
WHERE kind = 'personal';