-- Bridge to Sanctuary Voice (stage 8). A worship event connects to ONE SV event with a
-- short-lived connection code, exchanged server-to-server for a bridge token scoped to the
-- {worship event <-> SV event} pair (~12 h, revocable from either side). See docs/BRIDGE.md
-- and the SV protocol it points at. One bridge per worship event (PK on event_id).
--
-- The bridge token is a CLIENT credential worship-app must present back to SV (over REST and
-- on the /bridge socket), so unlike screen tokens it is kept usable: stored server-side only
-- and NEVER sent to any browser or API response (routes expose only status, languages and the
-- switches). token_fingerprint is a non-secret sha256 prefix, for logs, never the token.
--
-- Both direction switches DEFAULT OFF (rule: an event with no bridge, and both switches off,
-- behaves exactly as worship-app does today):
--   dir_in   "Afișează traducerea pe proiector" — enables the translation projector source.
--   dir_out  "Trimite cântările spre traducere" — enables song.* / setlist.sections; needs the
--            church owner's one-time consent (admin_settings.bridge_out_consent_at; copyright).
-- Timestamps are Unix epoch milliseconds.
CREATE TABLE bridge_connections (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  sv_base_url TEXT NOT NULL,
  sv_event_id TEXT NOT NULL,
  bridge_token TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  target_languages TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  dir_in INTEGER NOT NULL DEFAULT 0,
  dir_out INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error')),
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_bridge_admin ON bridge_connections(admin_id);
