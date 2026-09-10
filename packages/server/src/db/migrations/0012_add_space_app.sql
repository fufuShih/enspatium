ALTER TABLE spaces ADD COLUMN app text;
ALTER TABLE spaces ADD CONSTRAINT spaces_app_check
  CHECK (app IS NULL OR (app = 'media' AND type = 'object'));
