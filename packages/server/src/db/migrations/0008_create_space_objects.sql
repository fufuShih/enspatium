CREATE TABLE space_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  space_id uuid NOT NULL
    REFERENCES spaces(id)
    ON DELETE CASCADE,

  created_by_user_id uuid
    REFERENCES users(id)
    ON DELETE SET NULL,

  key text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  checksum_sha256 text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT space_objects_key_length
    CHECK (length(key) BETWEEN 1 AND 1024),

  CONSTRAINT space_objects_content_type_length
    CHECK (length(content_type) BETWEEN 1 AND 255),

  CONSTRAINT space_objects_size_non_negative
    CHECK (size_bytes >= 0),

  CONSTRAINT space_objects_checksum_sha256_format
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT space_objects_space_key_unique
    UNIQUE (space_id, key)
);

CREATE INDEX space_objects_space_key_index
ON space_objects (space_id, key text_pattern_ops);
