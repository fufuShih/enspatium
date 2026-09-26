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
before closing the database.

Admins start checks from **Site administration → Storage**, then view persisted
history at `/settings/admin/jobs`. Leaving the page does not stop execution.
Queued jobs can be cancelled; failed checks can create a new manual retry.
Execution status and report findings are separate: `succeeded` can still have an
`issues` or `incomplete` report. Unfinished views poll every two seconds and stop
at a terminal state. Reports may contain storage paths and are admin-only.

The session-authenticated API (browser prefix `/api`) exposes:

- `GET /admin/jobs?status=failed&cursor=<id>&limit=30`: newest first; default 30,
  maximum 100, without reports. `nextCursor: null` ends pagination.
- `POST /admin/jobs`: `{ "kind": "storage.check", "payload": { "deep": false } }`;
  optionally include `payload.spaceId`. Returns 202; pending checks conflict (409).
- `GET /admin/jobs/:id`: state, timestamps, error summary and persisted report.
- `POST /admin/jobs/:id/cancel`: queued only, returns 200.
- `POST /admin/jobs/:id/retry`: failed read-only check only, returns a new job (202).

Every request rechecks the current administrator role. Mutations also reject a
supplied cross-origin `Origin`; clients without an Origin remain supported.
Responses are private/no-store. The synchronous `POST /admin/storage/check`
endpoint remains available for existing clients and shares the same storage lock.
