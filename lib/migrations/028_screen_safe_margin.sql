-- "Margine de siguranță proiector": some projectors crop the edges (overscan). The church
-- default lives in admin_settings (safe_margin, 0-12 %, default 5); a paired screen may
-- override it here (NULL = the church default).
ALTER TABLE screens ADD COLUMN safe_margin INTEGER CHECK (safe_margin IS NULL OR (safe_margin >= 0 AND safe_margin <= 12));
