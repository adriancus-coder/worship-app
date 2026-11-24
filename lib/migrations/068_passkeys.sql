-- Passkeys (WebAuthn): "Intră cu Face ID / amprentă". One row per credential a person
-- registered on a device (a platform passkey syncs through the person's own cloud keychain).
-- public_key: the COSE key as a JWK (JSON); alg: -7 (ES256) or -257 (RS256); counter: the
-- authenticator's signature counter (0 forever on synced passkeys).
CREATE TABLE passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX idx_passkeys_user ON passkeys(admin_id, user_id);
