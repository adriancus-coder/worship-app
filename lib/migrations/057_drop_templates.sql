-- Event templates are gone from the product ("+ Eveniment nou" and "Planifică" start from
-- the church's usual service and random song ideas instead): the template rows go, with
-- their items and assignments (cascade), and the remembered "last template" setting.
-- The is_template column stays (always 0 from now on).
DELETE FROM events WHERE is_template = 1;
DELETE FROM admin_settings WHERE key = 'last_template_id';
