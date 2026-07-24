-- Migration 006: temporary (time-boxed) access grants
--
-- Adds the ability to request/approve access for a fixed number of hours
-- instead of only ever permanent. Two new columns:
--
--   access_requests.duration_hours  -- requester's ask, e.g. 4 / 24 / 168.
--                                    NULL = permanent (unchanged behavior).
--   access_requests.expires_at      -- stamped at approval time from
--                                    duration_hours; NULL until then, and
--                                    stays NULL forever for permanent
--                                    requests / denied requests.
--   user_roles.expires_at           -- copied from access_requests.expires_at
--                                    onto the grant itself at approval time.
--                                    This is the column checkPermission.js
--                                    actually enforces against — expiry is
--                                    evaluated at check-time (NOW() > this
--                                    column) rather than by any background
--                                    job, so an expired grant stops working
--                                    on the very next request with no cron
--                                    needed.
--
-- Both expires_at columns are nullable and default NULL, so every existing
-- access_requests/user_roles row is treated as permanent — this migration
-- changes no existing behavior on its own.
--
-- Run with:
--   psql "$DATABASE_URL" -f backend/src/migrations/006_add_temporary_access.sql

BEGIN;

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS duration_hours INTEGER,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

COMMIT;