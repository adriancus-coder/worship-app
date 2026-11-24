-- Per song item: whether the team sees its chords at this event ("Cu acorduri" / "Fără
-- acorduri" in the event editor). 1 = with chords (as before), 0 = lyrics only for the team.
-- The projector never shows chords either way.
ALTER TABLE setlist_items ADD COLUMN chords INTEGER NOT NULL DEFAULT 1 CHECK (chords IN (0, 1));
