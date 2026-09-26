-- Sanitized installation assets belong to the App, not to the source Object.
-- Keep both sizes in the same transaction as settings and audit events.
ALTER TABLE space_apps
  ADD COLUMN pwa_icon_192 bytea,
  ADD COLUMN pwa_icon_512 bytea,
  ADD CONSTRAINT space_apps_pwa_icons CHECK (
    (pwa_icon_192 IS NULL AND pwa_icon_512 IS NULL)
    OR (pwa_icon_192 IS NOT NULL AND pwa_icon_512 IS NOT NULL
      AND octet_length(pwa_icon_192) BETWEEN 1 AND 1048576
      AND octet_length(pwa_icon_512) BETWEEN 1 AND 1048576)
  );
