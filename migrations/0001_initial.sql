CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_notified_date TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_subscriptions_school_id ON subscriptions(school_id);

CREATE TABLE notification_log (
  school_id TEXT NOT NULL,
  date TEXT NOT NULL,
  notified_at TEXT NOT NULL,
  PRIMARY KEY (school_id, date)
);
