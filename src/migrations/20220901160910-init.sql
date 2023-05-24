--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  state      TEXT    NOT NULL,
  reason     TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  createdAt  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX events_ix_state ON events (state);
CREATE INDEX events_ix_createdAt ON events (createdAt);


CREATE TABLE records (
  id                       INTEGER PRIMARY KEY,
  eventId                  INTEGER NOT NULL,
  loadFromZoomState        TEXT    NOT NULL,
  loadFromZoomError        TEXT    NOT NULL DEFAULT "",
  loadToYoutubeState       TEXT    NOT NULL,
  loadToYoutubeLastAction  TEXT    NOT NULL DEFAULT "",
  loadToYoutubeError       TEXT    NOT NULL DEFAULT "",
  data                     TEXT    NOT NULL,
  createdAt                TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT records_fk_eventId FOREIGN KEY (eventId) REFERENCES events (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX records_ix_eventId ON records (eventId);
CREATE INDEX records_ix_zoom ON records (loadFromZoomState);
CREATE INDEX records_ix_youtube ON records (loadToYoutubeState);
CREATE INDEX records_ix_createdAt ON records (createdAt);


CREATE TABLE extra (
  id   INTEGER PRIMARY KEY,
  key  TEXT    NOT NULL,
  data TEXT    NOT NULL
);

CREATE INDEX extra_ix_key ON extra (key);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX events_ix_state;
DROP INDEX events_ix_createdAt;

DROP INDEX records_ix_eventId;
DROP INDEX records_ix_zoom;
DROP INDEX records_ix_youtube;
DROP INDEX records_ix_createdAt;

DROP INDEX extra_ix_key;

DROP TABLE events;
DROP TABLE records;
DROP TABLE extra;
