ALTER TABLE users
  ADD COLUMN is_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN session_version integer NOT NULL DEFAULT 0;
