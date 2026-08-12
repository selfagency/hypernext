-- V0002__pgp_host_keys.sql
-- Hypernext Phase 2: host -> signing-key TOFU mapping for smolnet PGP-verified
-- content (p2-t7). The Phase-1 `tofu_pgp_keys` table is keyed by fingerprint
-- (fingerprint -> armored_key); PGP TOFU additionally needs a host-keyed map:
-- on first successful verify we pin the signer fingerprint for a host, and on
-- subsequent verifies a different fingerprint is reported as KeyChanged.

CREATE TABLE tofu_pgp_host_keys (
    host        TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    armored_key TEXT NOT NULL,
    first_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_tofu_pgp_host_keys_fingerprint ON tofu_pgp_host_keys (fingerprint);
