-- End-to-end encrypted sync for the native apps (docs/native-data-store.md).
-- Accounts are identified by the SHA-256 of a signing public key derived from the user's sync key.
BEGIN;
CREATE TABLE IF NOT EXISTS sync_accounts (
    account text PRIMARY KEY CHECK (account ~ '^[0-9a-f]{64}$'),
    public_key text NOT NULL CHECK (public_key ~ '^0[23][0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_records (
    account text NOT NULL REFERENCES sync_accounts(account) ON DELETE CASCADE,
    record text NOT NULL CHECK (record IN ('genotype','results','customization','imported-results')),
    revision bigint NOT NULL CHECK (revision > 0),
    ciphertext bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account, record)
);
-- Replay protection; entries older than the request window are pruned.
CREATE TABLE IF NOT EXISTS sync_nonces (
    account text NOT NULL,
    nonce text NOT NULL,
    seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account, nonce)
);
CREATE INDEX IF NOT EXISTS sync_nonces_seen ON sync_nonces (seen_at);
COMMIT;
