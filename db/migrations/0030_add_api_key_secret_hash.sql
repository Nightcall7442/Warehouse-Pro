-- P1.3: Argon2id verification hash for API keys.
--
-- `key_hash` stays the deterministic lookup column (legacy rows: sha256(raw),
-- upgraded rows: hmac-sha256(raw, APP_SECRET)). `key_secret_hash` holds the
-- Argon2id hash that is verified after the lookup; it is NULL on existing rows
-- until their first successful verification rehashes them in place.
ALTER TABLE `api_keys` ADD COLUMN `key_secret_hash` VARCHAR(255) NULL AFTER `key_hash`;
