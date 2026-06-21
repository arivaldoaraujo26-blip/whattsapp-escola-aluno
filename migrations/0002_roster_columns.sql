ALTER TABLE teachers ADD COLUMN external_ref TEXT;
CREATE UNIQUE INDEX idx_teachers_external ON teachers(external_ref) WHERE external_ref IS NOT NULL;

ALTER TABLE guardians ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
