CREATE TYPE space_member_role AS ENUM (
  'owner',
  'writer',
  'reader'
);

CREATE TABLE space_members (
  space_id uuid NOT NULL
    REFERENCES spaces(id)
    ON DELETE CASCADE,

  user_id uuid NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  role space_member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX space_members_user_id_index
ON space_members (user_id);

CREATE UNIQUE INDEX space_members_one_owner_per_space
ON space_members (space_id)
WHERE role = 'owner';

-- Backfill an owner for spaces created before this migration.
INSERT INTO space_members (
  space_id,
  user_id,
  role
)
SELECT
  spaces.id,
  COALESCE(spaces.created_by_user_id, namespaces.owner_user_id),
  'owner'
FROM spaces
INNER JOIN namespaces
  ON namespaces.id = spaces.namespace_id;
