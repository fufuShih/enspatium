CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  actor_user_id uuid,
  namespace_id uuid,
  space_id uuid,

  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_events_action_not_empty
    CHECK (length(trim(action)) > 0),

  CONSTRAINT audit_events_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

-- Audit identifiers intentionally have no foreign keys so historical events
-- remain readable after their user, namespace, or space is deleted.
CREATE INDEX audit_events_space_created_at_index
ON audit_events (space_id, created_at DESC, id DESC);

CREATE INDEX audit_events_namespace_created_at_index
ON audit_events (namespace_id, created_at DESC, id DESC);

CREATE INDEX audit_events_actor_created_at_index
ON audit_events (actor_user_id, created_at DESC, id DESC);
