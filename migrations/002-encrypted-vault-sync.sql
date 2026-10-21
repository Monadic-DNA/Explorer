BEGIN;
CREATE TABLE IF NOT EXISTS encrypted_user_vaults (
    wallet text PRIMARY KEY CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
    vault_id uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision>0),
    archive jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
