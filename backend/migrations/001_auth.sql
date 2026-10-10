-- Users, their verified login identities, server-side sessions and email one-time codes.
-- Room state is intentionally NOT stored here (it stays in memory).

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE,            -- normalised (trimmed, lower-case); always verified
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- One row per way a user can sign in. We only ever store VERIFIED identities
-- (Google ID token with email_verified=true, or an email OTP that was just redeemed).
CREATE TABLE auth_identities (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('google', 'email')),
  subject           text NOT NULL,               -- google: the `sub` claim; email: the normalised address
  email             text NOT NULL,
  email_verified_at timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

-- Opaque-token sessions. Only the SHA-256 of the token is stored.
-- kind = 'user'  -> signed-in account;  kind = 'guest' -> short-lived invite-link identity.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  kind         text NOT NULL CHECK (kind IN ('user', 'guest')),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  guest_id     uuid,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  CHECK (
    (kind = 'user'  AND user_id IS NOT NULL AND guest_id IS NULL) OR
    (kind = 'guest' AND user_id IS NULL     AND guest_id IS NOT NULL)
  )
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Email one-time codes. Only an HMAC of the code is stored, never the code itself.
CREATE TABLE otp_challenges (
  id             uuid PRIMARY KEY,
  email          text NOT NULL,
  code_hmac      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  attempts       integer NOT NULL DEFAULT 0,
  max_attempts   integer NOT NULL DEFAULT 5,
  consumed_at    timestamptz,
  invalidated_at timestamptz
);
CREATE INDEX otp_challenges_email_idx ON otp_challenges (email, created_at DESC);
