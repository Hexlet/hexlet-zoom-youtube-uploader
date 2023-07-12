--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE playlists (
  id            INTEGER PRIMARY KEY,
  youtubeId     TEXT    NOT NULL,
  youtubeTitle  TEXT    NOT NULL,
  data          TEXT    NOT NULL,
  createdAt     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX playlists_ix_youtubeTitle ON playlists (youtubeTitle);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX playlists_ix_youtubeTitle;

DROP TABLE playlists;
