-- Chord notation for display: 'letters' (C D E) or 'solfege' (Do Re Mi). Storage is
-- always letters. NULL = use the church default, the admin setting
-- "chord_notation_default" (itself 'letters' when not set).
ALTER TABLE users ADD COLUMN chord_notation TEXT CHECK (chord_notation IN ('letters', 'solfege'));
