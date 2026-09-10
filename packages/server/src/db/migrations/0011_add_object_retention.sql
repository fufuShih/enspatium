ALTER TABLE spaces
  ADD COLUMN object_version_limit integer NOT NULL DEFAULT 3 CHECK (object_version_limit BETWEEN 1 AND 1000),
  ADD COLUMN object_retention_days integer NOT NULL DEFAULT 7 CHECK (object_retention_days BETWEEN 1 AND 36500);

ALTER TABLE space_object_versions
  ADD COLUMN inactive_at timestamptz,
  ADD COLUMN purge_started_at timestamptz;

-- Becoming inactive is a separate event from uploading: a file that remained
-- current for years must still get its full grace period after replacement.
WITH history AS (
  SELECT id, lead(created_at) OVER (PARTITION BY object_id ORDER BY revision) AS replaced_at
  FROM space_object_versions
)
UPDATE space_object_versions AS version
SET inactive_at = history.replaced_at
FROM history WHERE history.id = version.id AND history.replaced_at IS NOT NULL;

CREATE INDEX space_object_versions_inactive_index
  ON space_object_versions (space_id, inactive_at) WHERE inactive_at IS NOT NULL;
