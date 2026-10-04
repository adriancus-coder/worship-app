-- Live state per event (stage 4). The server is the single source of truth: every applied
-- command increments `version`, and clients render only the snapshots they receive.
--
-- A position is a setlist item id + a step. For a song the steps are its arrangement WITH
-- repeats ("V1 C V2 C B C" -> 6 steps, 0..5); every other item has exactly one step (0).
--
--   worship_*    the worship position, moved by the leader; team phones follow it.
--   projector_*  the projector position and source (stage 5). Until then it stays at the
--                defaults: the projector follows worship and shows content.
-- Timestamps are Unix epoch milliseconds.
CREATE TABLE live_state (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  worship_item_id INTEGER,
  worship_step INTEGER NOT NULL DEFAULT 0,
  projector_follows TEXT NOT NULL DEFAULT 'worship' CHECK (projector_follows IN ('worship', 'operator')),
  projector_item_id INTEGER,
  projector_step INTEGER NOT NULL DEFAULT 0,
  projector_source TEXT NOT NULL DEFAULT 'content'
    CHECK (projector_source IN ('content', 'logo', 'black', 'video', 'translation')),
  started_at INTEGER,
  updated_at INTEGER NOT NULL
);
