-- Demo seed data for the Manager Dashboard (team overview, access requests,
-- leave requests/history, tasks). Safe to run multiple times — everything
-- is scoped to whatever manager you point it at via :manager_email below,
-- and re-running just adds a few more rows rather than erroring.
--
-- HOW TO RUN (adjust the manager's email on the next line first):
--   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5436 -U postgres -d accessos -f "seed-demo-data.sql"

\set manager_email '''priyanga@nexagen.com'''

-- 1. Make sure a few employees actually report to this manager, so "My
--    Team" / stat cards aren't empty. Picks up to 3 existing employees
--    with no manager currently assigned and points them at this manager.
--    Harmless if they're already assigned to someone — this only touches
--    users where manager_id IS NULL.
WITH mgr AS (
  SELECT id FROM users WHERE email = :manager_email
),
candidates AS (
  SELECT u.id
  FROM users u, mgr
  WHERE u.manager_id IS NULL
    AND u.id <> mgr.id
    AND u.id NOT IN (SELECT id FROM users WHERE email LIKE '%.pending@nexagen.com') -- leave the existing demo pending-request user alone if you rely on it elsewhere
  ORDER BY u.id
  LIMIT 3
)
UPDATE users SET manager_id = (SELECT id FROM mgr)
WHERE id IN (SELECT id FROM candidates);

-- 2. A couple of fake ACCESS requests waiting on this manager, plus one
--    already decided (for "Approval History").
WITH mgr AS (SELECT id FROM users WHERE email = :manager_email),
     team AS (SELECT id FROM users WHERE manager_id = (SELECT id FROM mgr) LIMIT 2),
     role AS (SELECT id FROM roles WHERE name = 'finance' LIMIT 1)
INSERT INTO access_requests (user_id, requested_role_id, status, manager_id, duration_hours)
SELECT id, (SELECT id FROM role), 'PENDING_MANAGER', (SELECT id FROM mgr), NULL
FROM team;

WITH mgr AS (SELECT id FROM users WHERE email = :manager_email),
     u AS (SELECT id FROM users WHERE manager_id = (SELECT id FROM mgr) LIMIT 1),
     role AS (SELECT id FROM roles WHERE name = 'hr' LIMIT 1)
INSERT INTO access_requests (user_id, requested_role_id, status, manager_id, manager_decision_at, manager_comment, duration_hours)
SELECT id, (SELECT id FROM role), 'PENDING_ADMIN', (SELECT id FROM mgr), NOW() - INTERVAL '2 days', 'Looks fine to me', NULL
FROM u;

-- 3. A couple of fake LEAVE requests waiting on this manager, plus one
--    already decided (for "Leave History").
WITH mgr AS (SELECT id FROM users WHERE email = :manager_email),
     team AS (SELECT id FROM users WHERE manager_id = (SELECT id FROM mgr) LIMIT 2)
INSERT INTO leave_requests (user_id, manager_id, start_date, end_date, reason, status)
SELECT id, (SELECT id FROM mgr), CURRENT_DATE + 5, CURRENT_DATE + 7, 'Family function', 'PENDING'
FROM team;

WITH mgr AS (SELECT id FROM users WHERE email = :manager_email),
     u AS (SELECT id FROM users WHERE manager_id = (SELECT id FROM mgr) LIMIT 1)
INSERT INTO leave_requests (user_id, manager_id, start_date, end_date, reason, status, manager_comment, decided_at)
SELECT id, (SELECT id FROM mgr), CURRENT_DATE - 10, CURRENT_DATE - 8, 'Medical', 'APPROVED', 'Get well soon', NOW() - INTERVAL '9 days'
FROM u;

-- 4. A few fake TASKS assigned by this manager, in different statuses, so
--    "pendingTasks" on the overview isn't 0 and the task list isn't empty.
WITH mgr AS (SELECT id FROM users WHERE email = :manager_email),
     team AS (SELECT id FROM users WHERE manager_id = (SELECT id FROM mgr))
INSERT INTO tasks (title, description, assigned_to, assigned_by, status, due_date)
SELECT
  vals.title, vals.description, team.id, (SELECT id FROM mgr), vals.status, CURRENT_DATE + vals.due_offset
FROM team
CROSS JOIN LATERAL (
  VALUES
    ('Prep Q3 demo slides', 'Pull together the hackathon walkthrough deck', 'in_progress', 2),
    ('Review PR #42', 'Check the leave-management endpoints', 'todo', 1),
    ('Update onboarding doc', 'Add the new manager dashboard section', 'done', -3)
) AS vals(title, description, status, due_offset)
LIMIT 3;

-- Quick sanity check: run this to see what got created.
SELECT 'team' AS what, count(*) FROM users WHERE manager_id = (SELECT id FROM users WHERE email = :manager_email)
UNION ALL
SELECT 'access_requests', count(*) FROM access_requests WHERE manager_id = (SELECT id FROM users WHERE email = :manager_email)
UNION ALL
SELECT 'leave_requests', count(*) FROM leave_requests WHERE manager_id = (SELECT id FROM users WHERE email = :manager_email)
UNION ALL
SELECT 'tasks', count(*) FROM tasks WHERE assigned_by = (SELECT id FROM users WHERE email = :manager_email);