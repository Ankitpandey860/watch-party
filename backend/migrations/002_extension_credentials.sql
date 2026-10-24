-- Browser-extension ("companion") credentials. A credential is created when a signed-in participant
-- pairs the extension with a ONE-TIME pairing code (codes live only in memory, never in this table).
-- It is bound to the pairing session, the principal and ONE room, and is revocable at any time.
-- Only the SHA-256 of the token is stored. Nothing from any OTT provider is ever stored here.
CREATE TABLE extension_credentials (
  id            uuid PRIMARY KEY,
  token_hash    text NOT NULL UNIQUE,
  session_id    uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  principal_id  uuid NOT NULL,
  room_id       text NOT NULL,
  label         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX extension_credentials_session_room_idx ON extension_credentials (session_id, room_id);
CREATE INDEX extension_credentials_expires_idx ON extension_credentials (expires_at);
