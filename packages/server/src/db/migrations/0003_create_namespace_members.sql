CREATE TYPE namespace_member_role AS ENUM (
    'owner',
    'member'
);

CREATE TABLE namespace_members (
    namespace_id uuid NOT NULL
        REFERENCES namespaces(id)
        ON DELETE CASCADE,

    user_id uuid NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    role namespace_member_role NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (namespace_id, user_id)
);

CREATE INDEX namespace_members_user_id_index
ON namespace_members (user_id);

CREATE UNIQUE INDEX namespace_members_one_owner_per_namespace
ON namespace_members (namespace_id)
WHERE role = 'owner';

-- Add owner membership to existing namespaces
INSERT INTO namespace_members (
    namespace_id,
    user_id,
    role
)
SELECT
    id,
    owner_user_id,
    'owner'
FROM namespaces;