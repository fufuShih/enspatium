-- Keep the storage discriminator in both foreign keys so compatibility also
-- holds when a Space or registry entry is changed outside the service layer.
ALTER TABLE spaces ADD CONSTRAINT spaces_id_type_unique UNIQUE (id, type);

CREATE TABLE space_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  app_type text NOT NULL,
  storage_type space_type NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  pwa jsonb NOT NULL DEFAULT '{"enabled":false,"iconObjectId":null,"themeColor":null,"offlinePolicy":"shell"}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT space_apps_space_storage_fk FOREIGN KEY (space_id, storage_type)
    REFERENCES spaces(id, type) ON DELETE CASCADE,
  CONSTRAINT space_apps_app_type_storage_fk FOREIGN KEY (app_type, storage_type)
    REFERENCES app_types(type, storage_type) ON DELETE RESTRICT,
  CONSTRAINT space_apps_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT space_apps_config_object CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT space_apps_config_size CHECK (octet_length(config::text) <= 32768),
  CONSTRAINT space_apps_pwa_shape CHECK (
    jsonb_typeof(pwa) = 'object'
    AND pwa ?& ARRAY['enabled', 'iconObjectId', 'themeColor', 'offlinePolicy']
    AND pwa - ARRAY['enabled', 'iconObjectId', 'themeColor', 'offlinePolicy'] = '{}'
    AND jsonb_typeof(pwa->'enabled') = 'boolean'
    AND (pwa->'iconObjectId' = 'null' OR (
      jsonb_typeof(pwa->'iconObjectId') = 'string'
      AND pwa->>'iconObjectId' ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
    ))
    AND (pwa->'themeColor' = 'null' OR (
      jsonb_typeof(pwa->'themeColor') = 'string'
      AND pwa->>'themeColor' ~ '^#[0-9a-fA-F]{6}$'
    ))
    AND jsonb_typeof(pwa->'offlinePolicy') = 'string'
    AND pwa->>'offlinePolicy' = 'shell'
  )
);

CREATE INDEX space_apps_space_id_idx ON space_apps (space_id, created_at, id);
CREATE INDEX space_apps_app_type_idx ON space_apps (app_type);

-- The original instance keeps its Space UUID for existing bookmarks. New
-- instances use independent UUIDs, including multiple instances of one type.
INSERT INTO space_apps (id, space_id, app_type, storage_type, name, created_at, updated_at)
SELECT id, id, app_type, type, name, created_at, updated_at
FROM spaces WHERE app_type IS NOT NULL;

CREATE FUNCTION protect_space_app_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.space_id, NEW.app_type, NEW.storage_type, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.space_id, OLD.app_type, OLD.storage_type, OLD.created_at) THEN
    RAISE EXCEPTION 'App instance identity and type are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER space_apps_protect_identity BEFORE UPDATE ON space_apps
FOR EACH ROW EXECUTE FUNCTION protect_space_app_identity();
