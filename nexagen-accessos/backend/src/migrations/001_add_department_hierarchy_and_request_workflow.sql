-- Migration 001: department/manager hierarchy + multi-stage access-request workflow
--
-- Additive only — does not touch any existing column, table, or row shape
-- beyond access_requests.status (see backfill below). Mirrors the same
-- change now committed in docs/schema.sql, so a fresh `psql -f schema.sql`
-- install and an existing DB that runs this migration end up identical.
--
-- Safe to re-run: every ADD COLUMN uses IF NOT EXISTS, the role insert uses
-- ON CONFLICT DO NOTHING, and the backfill UPDATEs are idempotent (a second
-- run just matches zero rows).
--
-- Run with:
--   psql "$DATABASE_URL" -f backend/src/migrations/001_add_department_hierarchy_and_request_workflow.sql

BEGIN;

-- --------------------------------------------------------------------------
-- users: org hierarchy fields
-- --------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id);

COMMENT ON COLUMN users.status IS
  'active | inactive — user account status. Unrelated to access_requests.status.';

-- --------------------------------------------------------------------------
-- roles: new 'manager' role (first-stage approver for access requests)
-- --------------------------------------------------------------------------
INSERT INTO roles (name, description)
VALUES ('manager', 'Reviews direct reports'' access requests (first-stage approval)')
ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- access_requests: manager review stage + admin comment
-- --------------------------------------------------------------------------
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id);
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS manager_decision_at TIMESTAMP;
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS manager_comment TEXT;
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS admin_comment TEXT;

-- Status moves from a single-stage (pending | approved | denied) to a
-- multi-stage workflow. Change the default going forward...
ALTER TABLE access_requests ALTER COLUMN status SET DEFAULT 'PENDING_MANAGER';

-- ...and backfill existing rows so nothing is left in the old vocabulary.
-- NOTE: Request.routes.js (Backend Dev 2, not touched by this change) still
-- hardcodes 'pending' on insert and 'approved'/'denied' on review as of this
-- migration — flag this to the team so that route gets updated to the new
-- PENDING_MANAGER -> PENDING_ADMIN -> APPROVED/REJECTED/REVOKED vocabulary,
-- or new requests will keep landing as 'pending' after this ships.
UPDATE access_requests SET status = 'PENDING_MANAGER' WHERE status = 'pending';
UPDATE access_requests SET status = 'APPROVED'        WHERE status = 'approved';
UPDATE access_requests SET status = 'REJECTED'         WHERE status = 'denied';

COMMENT ON COLUMN access_requests.status IS
  'PENDING_MANAGER | PENDING_ADMIN | APPROVED | REJECTED | REVOKED';

COMMIT;