CREATE TABLE cron_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  schools_checked INTEGER NOT NULL,
  notified INTEGER NOT NULL,
  error TEXT
);
