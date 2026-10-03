-- OpenSong presentation order (e.g. "V1 C V2 C B C") kept from imports.
-- Stage 3 uses it as the default arrangement. NULL = none.
ALTER TABLE songs ADD COLUMN presentation TEXT;
