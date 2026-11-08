-- A song marked by hand as already sung (or not) on the live page's Program (item.mark):
-- overrides the automatic tick from live_shown. Rows go with the event; event.start clears them.
CREATE TABLE live_marks (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  done INTEGER NOT NULL,
  PRIMARY KEY (event_id, item_id)
);
