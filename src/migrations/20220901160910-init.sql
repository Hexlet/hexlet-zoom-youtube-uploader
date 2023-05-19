--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  owner      TEXT    NOT NULL,
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
  owner                    TEXT    NOT NULL,
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


CREATE TABLE google_clients (
  id            INTEGER PRIMARY KEY,
  owner         TEXT    NOT NULL,
  client_id     TEXT    NOT NULL,
  channel_id    TEXT    NOT NULL DEFAULT "",
  client_secret TEXT    NOT NULL,
  tokens        TEXT    NOT NULL DEFAULT ""
);

CREATE INDEX google_clients_ix_owner ON google_clients (owner);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX events_ix_state;
DROP INDEX events_ix_createdAt;

DROP INDEX records_ix_eventId;
DROP INDEX records_ix_zoom;
DROP INDEX records_ix_youtube;
DROP INDEX records_ix_createdAt;

DROP INDEX google_clients_ix_owner;

DROP TABLE events;
DROP TABLE records;
DROP TABLE google_clients;
