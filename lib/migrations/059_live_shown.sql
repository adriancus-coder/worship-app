-- Which screens (steps) of each programme item the projector has shown during the event
-- (projector source "content"): the leader's compact list ticks a song once more than 70 %
-- of its screens were projected. Rows go with the event; event.start clears them.
CREATE TABLE live_shown (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  step INTEGER NOT NULL,
  PRIMARY KEY (event_id, item_id, step)
);
