CREATE TABLE school_directory (
  school_code TEXT PRIMARY KEY,
  school_name TEXT NOT NULL,
  county TEXT NOT NULL,
  school_stage TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_school_directory_county ON school_directory(county);
CREATE INDEX idx_school_directory_name ON school_directory(school_name);

CREATE TABLE verified_school_ids (
  school_code TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
