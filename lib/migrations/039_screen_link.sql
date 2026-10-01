-- A static link per projector screen: /screen/<link_key> opens that screen's output directly,
-- on any PC, at any time, without a pairing code (the key is a random 12-character secret
-- given out on /screens; it stays valid until the screen is revoked). Existing screens get
-- a key the first time the store opens (lib/screens.js ensureLinkKeys).
ALTER TABLE screens ADD COLUMN link_key TEXT;
CREATE UNIQUE INDEX idx_screens_link_key ON screens(link_key);
