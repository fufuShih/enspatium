CREATE TABLE personal_access_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    name text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    scopes text[] NOT NULL,
    expires_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT personal_access_tokens_name_not_empty
        CHECK (length(trim(name)) > 0),

    CONSTRAINT personal_access_tokens_name_length
        CHECK (length(name) <= 100),

    CONSTRAINT personal_access_tokens_hash_format
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),

    CONSTRAINT personal_access_tokens_scopes_not_empty
        CHECK (cardinality(scopes) > 0),

    CONSTRAINT personal_access_tokens_scopes_allowed
        CHECK (scopes <@ ARRAY['git:read', 'git:write']::text[])
);

CREATE INDEX personal_access_tokens_user_id_created_at_index
ON personal_access_tokens (user_id, created_at DESC);
