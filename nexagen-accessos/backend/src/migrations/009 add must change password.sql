-- Migration 009: forced password change
--
-- Adds users.must_change_password so an admin (or a future "reset password"
-- flow) can force a user to pick a new password on next login. Defaults to
-- false, so every existing user is unaffected by this migration on its own.
--
-- POST /login (auth.routes.js) surfaces this on the response as
-- mustChangePassword so the frontend can redirect before showing the
-- dashboard. POST /auth/change-password clears it back to false once the
-- user has set a new password.
--
-- Run with:
--   psql "$DATABASE_URL" -f backend/src/migrations/009_add_must_change_password.sql

BEGIN;

ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;

COMMIT;
