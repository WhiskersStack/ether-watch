CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  generation TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT,
  last_accepted_at INTEGER,
  last_displayed_at INTEGER
);
