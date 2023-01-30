--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE events (
  id      INTEGER PRIMARY KEY,
  owner   TEXT    NOT NULL,
  state   TEXT    NOT NULL,
  data    TEXT    NOT NULL
);

CREATE INDEX events_ix_state ON events (state);


CREATE TABLE records (
  id                  INTEGER PRIMARY KEY,
  eventId             INTEGER NOT NULL,
  owner               TEXT    NOT NULL,
  loadFromZoomState   TEXT    NOT NULL,
  loadFromZoomError   TEXT    NOT NULL DEFAULT "",
  loadToYoutubeState  TEXT    NOT NULL,
  loadToYoutubeError  TEXT    NOT NULL DEFAULT "",
  data                TEXT    NOT NULL,
  CONSTRAINT records_fk_eventId FOREIGN KEY (eventId) REFERENCES events (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX records_ix_eventId ON records (eventId);
CREATE INDEX records_ix_zoom ON records (loadFromZoomState);
CREATE INDEX records_ix_youtube ON records (loadToYoutubeState);


CREATE TABLE tokens (
  id    INTEGER PRIMARY KEY,
  owner TEXT    NOT NULL,
  token TEXT    NOT NULL
);

CREATE INDEX tokens_ix_owner ON tokens (owner);


CREATE TABLE youtube_clients (
  id            INTEGER PRIMARY KEY,
  owner         TEXT    NOT NULL,
  client_id     TEXT    NOT NULL
  client_secret TEXT    NOT NULL
);

CREATE INDEX youtube_clients_ix_owner ON tokens (channel_owner);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX events_ix_state;

DROP INDEX records_ix_eventId;
DROP INDEX records_ix_zoom;
DROP INDEX records_ix_youtube;
DROP INDEX youtube_clients_ix_owner;

DROP TABLE events;
DROP TABLE records;
DROP TABLE tokens;
DROP TABLE youtube_clients;
