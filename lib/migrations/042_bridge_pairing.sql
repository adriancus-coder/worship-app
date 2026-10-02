-- Church pairing with Sanctuary Voice (docs/BRIDGE.md, "Church pairing"): the owner pairs the
-- church with an SV organisation ONCE, with a one-time pairing code from SV's admin; from then
-- on any event connects without a code (worship-app lists SV's events and exchanges the
-- pairing token for the per-event bridge token). One pairing per admin.
--
-- Like the bridge token, the pairing token is a client credential presented back to SV:
-- stored server-side only, never sent to a browser or an API response; token_fingerprint is
-- a non-secret sha256 prefix for logs. Revocable from either side (SV answers 401 "unpaired"
-- afterwards: status 'unpaired_remote' until the owner pairs again).
-- Timestamps are Unix epoch milliseconds.
CREATE TABLE bridge_pairings (
  admin_id INTEGER PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
  sv_base_url TEXT NOT NULL,
  pairing_token TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  sv_org_id TEXT NOT NULL,
  sv_org_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'paired' CHECK (status IN ('paired', 'unpaired_remote', 'error')),
  paired_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  paired_at INTEGER NOT NULL,
  last_checked_at INTEGER
);
