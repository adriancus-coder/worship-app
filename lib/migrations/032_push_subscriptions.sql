-- Stage 7: web push subscriptions (one per browser / device of a user). endpoint is the push
-- service URL; p256dh / auth the browser's keys (base64url). failed_count grows on delivery
-- errors; a 404 / 410 from the push service deletes the row.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  failed_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(admin_id, user_id);
