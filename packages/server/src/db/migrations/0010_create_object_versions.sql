ALTER TABLE space_objects
  ADD COLUMN current_version_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN is_deleted boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT space_objects_id_space_unique UNIQUE (id, space_id);

CREATE TABLE space_object_versions (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL,
  space_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  storage_key text,
  is_deleted boolean NOT NULL DEFAULT false,
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 1 AND 255),
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (object_id, space_id) REFERENCES space_objects(id, space_id) ON DELETE CASCADE,
  UNIQUE (object_id, revision),
  UNIQUE (object_id, id),
  UNIQUE (space_id, storage_key),
  CHECK ((is_deleted AND storage_key IS NULL AND size_bytes = 0)
    OR (NOT is_deleted AND storage_key IS NOT NULL AND length(storage_key) BETWEEN 1 AND 1024))
);

-- Preserve existing bytes in place. Legacy paths become immutable first-version
-- locators; all future content is written under fresh, server-generated IDs.
INSERT INTO space_object_versions
  (id, object_id, space_id, revision, storage_key, content_type, size_bytes,
   checksum_sha256, created_by_user_id, created_at)
SELECT current_version_id, id, space_id, 1, key, content_type, size_bytes,
  checksum_sha256, created_by_user_id, created_at FROM space_objects;

ALTER TABLE space_objects ADD CONSTRAINT space_objects_current_version_fk
  FOREIGN KEY (id, current_version_id) REFERENCES space_object_versions(object_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX space_object_versions_space_index ON space_object_versions(space_id);
