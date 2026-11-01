-- Which library a song belongs to: 'main' (the church's) or 'school' (the Sunday school's,
-- "Școala duminicală", written by the people with the 'school' right). One table, one search.
ALTER TABLE songs ADD COLUMN collection TEXT NOT NULL DEFAULT 'main';
CREATE INDEX idx_songs_collection ON songs(admin_id, collection);
