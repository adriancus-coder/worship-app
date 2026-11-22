-- "Așteaptă strofa": when the projector's holder moves to another song, the projector stays
-- black until a section of it is picked (the song never goes on screen by itself). A live
-- setting of the event (projector.awaitSection) started from the church default
-- (admin_settings await_section); NULL = the church default (rows from before this migration).
ALTER TABLE live_state ADD COLUMN await_section INTEGER;
