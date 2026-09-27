-- Backgrounds from a provider (Pexels): who made it and where it came from, kept with the
-- file and shown in the media list (never on the projector). JSON:
--   { "provider": "pexels", "photographer": "...", "photographerUrl": "...", "url": "..." }
ALTER TABLE media ADD COLUMN attribution TEXT;
