# Background jobs

The Server runs one embedded worker. Await `JobWorker.start()` before considering
startup complete: it marks residual `running` jobs as `failed / WORKER_INTERRUPTED`
before claiming work. Queued jobs and terminal reports persist. Failed jobs are
never retried automatically. Stop the old Server before starting its replacement;
this recovery model does not support overlapping servers or rolling deployments.

`cancelJob(db, actor, id)` permits only queued jobs and races atomically with claim.
`retryJob(db, actor, id)` accepts only failed, read-only `storage.check` jobs. Both
require a current active site administrator. Retry revalidates the saved payload
and Space, creates a new job attributed to the current actor, and preserves the
original job through `retry_of_job_id`. Concurrent pending checks return a conflict.

Shutdown stops polling and waits for an in-flight claim, handler and result write
before closing the database. These are internal services; Admin Jobs routes and UI
are the next implementation stage.
