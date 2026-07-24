-- Migration 007: leave requests
--
-- Employees submit leave requests; their manager approves/rejects, same
-- two-party shape as access_requests (request.routes.js / manager.routes.js)
-- but simpler — there's no admin second stage here, PENDING -> APPROVED /
-- REJECTED is terminal either way.
--
-- manager_id is a snapshot of users.manager_id taken at submission time,
-- same pattern as access_requests.manager_id (see Request.routes.js's
-- POST /access-requests) — if the requester's manager changes later, this
-- request stays with whoever it was assigned to when submitted.
--
-- Run with:
--   psql "$DATABASE_URL" -f backend/src/migrations/007_add_leave_requests.sql

BEGIN;

CREATE TABLE IF NOT EXISTS leave_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    manager_id INTEGER REFERENCES users(id), -- snapshot of users.manager_id at submission time, same pattern as access_requests.manager_id
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
    manager_comment TEXT,
    decided_at TIMESTAMP,
    requested_at TIMESTAMP DEFAULT NOW()
);

COMMIT;