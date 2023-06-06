--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

ALTER TABLE records ADD COLUMN isVideoRemoved INTEGER NOT NULL DEFAULT 0;

CREATE INDEX extra_ix_isVideoRemoved ON records (isVideoRemoved);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

ALTER TABLE records DROP COLUMN isVideoRemoved;

DROP INDEX extra_ix_isVideoRemoved;
