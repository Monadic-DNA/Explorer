-- Apply to POSTGRES_DB before enabling mobile billing. Contains purchase/account metadata only.
BEGIN;
CREATE TABLE IF NOT EXISTS mobile_billing_accounts (
    id uuid PRIMARY KEY,
    wallet text NOT NULL UNIQUE CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mobile_store_purchases (
    store text NOT NULL CHECK (store IN ('apple', 'google')),
    purchase_id text NOT NULL,
    account_id uuid NOT NULL REFERENCES mobile_billing_accounts(id),
    product_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('subscription', 'consumable')),
    report_type text CHECK (report_type IN ('overview','healthspan','top_traits')),
    proof text NOT NULL, -- AEAD-encrypted transaction ID / purchase token, never logged.
    valid_until timestamptz,
    revoked boolean NOT NULL DEFAULT false,
    consumed_at timestamptz,
    verified_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store, purchase_id),
    CHECK ((kind = 'subscription' AND report_type IS NULL) OR (kind = 'consumable' AND report_type IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mobile_store_account_idx ON mobile_store_purchases(account_id);
COMMIT;
