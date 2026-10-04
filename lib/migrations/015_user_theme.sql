-- Colour theme per user: NULL = the church default (admin setting theme_default, 'dark'
-- unless set), 'dark', 'light' or 'auto' (follows the device, resolved in the browser).
ALTER TABLE users ADD COLUMN theme TEXT CHECK (theme IN ('dark', 'light', 'auto'));
