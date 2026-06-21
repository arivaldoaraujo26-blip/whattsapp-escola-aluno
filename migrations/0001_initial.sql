CREATE TABLE teachers (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  evolution_instance TEXT NOT NULL UNIQUE,
  phone_e164         TEXT NOT NULL UNIQUE,
  created_at         TEXT NOT NULL
);

CREATE TABLE students (
  id           TEXT PRIMARY KEY,
  teacher_id   TEXT NOT NULL REFERENCES teachers(id),
  name         TEXT NOT NULL,
  class_id     TEXT,
  external_ref TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_students_teacher ON students(teacher_id);
CREATE UNIQUE INDEX idx_students_external ON students(teacher_id, external_ref);

CREATE TABLE guardians (
  id         TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  name       TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  role       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_guardians_teacher ON guardians(teacher_id);
CREATE INDEX idx_guardians_phone ON guardians(teacher_id, phone_e164);

CREATE TABLE student_guardians (
  student_id  TEXT NOT NULL REFERENCES students(id),
  guardian_id TEXT NOT NULL REFERENCES guardians(id),
  PRIMARY KEY (student_id, guardian_id)
);

CREATE TABLE dispatched_messages (
  id                  TEXT PRIMARY KEY,
  teacher_id          TEXT NOT NULL REFERENCES teachers(id),
  broadcast_group_id  TEXT,
  student_id          TEXT REFERENCES students(id),
  guardian_id         TEXT NOT NULL REFERENCES guardians(id),
  draft_text          TEXT NOT NULL,
  body_text           TEXT NOT NULL,
  status              TEXT NOT NULL,
  provider_message_id TEXT,
  created_at          TEXT NOT NULL,
  sent_at             TEXT,
  failed_reason       TEXT
);
CREATE INDEX idx_dispatched_teacher ON dispatched_messages(teacher_id, created_at DESC);
CREATE INDEX idx_dispatched_broadcast ON dispatched_messages(broadcast_group_id);
CREATE INDEX idx_dispatched_provider ON dispatched_messages(provider_message_id);

CREATE TABLE delivery_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatched_message_id TEXT NOT NULL REFERENCES dispatched_messages(id),
  status                TEXT NOT NULL,
  observed_at           TEXT NOT NULL
);
CREATE INDEX idx_delivery_msg ON delivery_events(dispatched_message_id);

CREATE TABLE acknowledgements (
  dispatched_message_id TEXT PRIMARY KEY REFERENCES dispatched_messages(id),
  inbound_message_id    TEXT NOT NULL,
  acknowledged_at       TEXT NOT NULL
);

CREATE TABLE inbound_messages (
  id                  TEXT PRIMARY KEY,
  teacher_id          TEXT NOT NULL REFERENCES teachers(id),
  guardian_id         TEXT REFERENCES guardians(id),
  provider_message_id TEXT,
  body_text           TEXT NOT NULL,
  normalized_text     TEXT NOT NULL,
  received_at         TEXT NOT NULL
);
CREATE INDEX idx_inbound_teacher ON inbound_messages(teacher_id, received_at DESC);
