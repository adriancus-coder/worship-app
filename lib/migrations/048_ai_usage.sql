-- AI calls per church and month (lib/ai.js): a monthly cap (AI_MONTHLY_CALLS) and what was
-- spent, shown in Setări. month = 'YYYY-MM' (UTC).
CREATE TABLE ai_usage (
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (admin_id, month)
);
