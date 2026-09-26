CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  kind text NOT NULL,

  space_id uuid
    REFERENCES spaces(id)
    ON DELETE SET NULL,

  requested_by_user_id uuid
    REFERENCES users(id)
    ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL,
  result jsonb,
  error_code text,
  error_message text,

  retry_of_job_id uuid
    REFERENCES jobs(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,

  CONSTRAINT jobs_kind_length
    CHECK (length(kind) BETWEEN 1 AND 100),

  CONSTRAINT jobs_status_value
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),

  CONSTRAINT jobs_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT jobs_payload_size
    CHECK (pg_column_size(payload) <= 16384),

  CONSTRAINT jobs_result_object
    CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),

  CONSTRAINT jobs_result_size
    CHECK (result IS NULL OR pg_column_size(result) <= 1048576),

  CONSTRAINT jobs_error_code_length
    CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),

  CONSTRAINT jobs_error_message_length
    CHECK (error_message IS NULL OR length(error_message) BETWEEN 1 AND 2000),

  CONSTRAINT jobs_timestamps_order
    CHECK (
      (started_at IS NULL OR started_at >= created_at)
      AND (finished_at IS NULL OR finished_at >= created_at)
      AND (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
    ),

  CONSTRAINT jobs_state_shape
    CHECK (
      (status = 'queued'
        AND started_at IS NULL AND finished_at IS NULL
        AND result IS NULL AND error_code IS NULL AND error_message IS NULL)
      OR
      (status = 'running'
        AND started_at IS NOT NULL AND finished_at IS NULL
        AND result IS NULL AND error_code IS NULL AND error_message IS NULL)
      OR
      (status = 'succeeded'
        AND started_at IS NOT NULL AND finished_at IS NOT NULL
        AND error_code IS NULL AND error_message IS NULL)
      OR
      (status = 'failed'
        AND started_at IS NOT NULL AND finished_at IS NOT NULL
        AND result IS NULL AND error_code IS NOT NULL AND error_message IS NOT NULL)
      OR
      (status = 'cancelled'
        AND started_at IS NULL AND finished_at IS NOT NULL
        AND result IS NULL AND error_code IS NULL AND error_message IS NULL)
    )
);

CREATE INDEX jobs_queue_index
ON jobs (status, created_at, id);

CREATE INDEX jobs_requested_by_user_index
ON jobs (requested_by_user_id, created_at DESC);

CREATE INDEX jobs_space_index
ON jobs (space_id, created_at DESC);

CREATE UNIQUE INDEX jobs_one_unfinished_storage_check
ON jobs (kind)
WHERE kind = 'storage.check' AND status IN ('queued', 'running');
