-- Preserve any instances created before this rule while preventing additional
-- instances. Locking the parent row makes concurrent inserts deterministic.
CREATE FUNCTION enforce_single_space_app() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  space_storage space_type;
BEGIN
  SELECT type INTO space_storage FROM spaces WHERE id = NEW.space_id FOR UPDATE;
  IF space_storage = 'object' AND EXISTS (SELECT 1 FROM space_apps WHERE space_id = NEW.space_id) THEN
    RAISE EXCEPTION 'An Object Space can have only one App'
      USING ERRCODE = '23505', CONSTRAINT = 'space_apps_space_id_unique';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER space_apps_enforce_single BEFORE INSERT ON space_apps
FOR EACH ROW EXECUTE FUNCTION enforce_single_space_app();
