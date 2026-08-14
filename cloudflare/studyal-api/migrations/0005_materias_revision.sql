-- Optimistic concurrency for the durable academic tree.
-- Existing JSON data remains untouched and starts at revision 0.
ALTER TABLE materias ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
