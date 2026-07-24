import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/checkPermission.js';

const router = Router();

// Every route here scopes to req.user.id (the JWT subject) as "the
// manager" — never from a param or body, so there's no way to view or act
// on another manager's team/requests by guessing an id.

// GET /manager/team
// Response: [{ id, name, email, department, status }]
router.get('/team', requireAuth, requireRole('manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, department, status
       FROM users
       WHERE manager_id = $1
       ORDER BY name`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching team:', err);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// GET /manager/access-requests
// Response: [{ id, user: {...}, requestedRole: {...}, status, requestedAt,
//              managerComment }]
// Returns every request assigned to this manager at ALL stages, not just
// PENDING_MANAGER — Managerdashboard.jsx renders this same array twice:
// AccessRequestsReview filters status === 'PENDING_MANAGER', and
// ApprovalHistory filters status !== 'PENDING_MANAGER' from it.
router.get('/access-requests', requireAuth, requireRole('manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         ar.id,
         ar.status,
         ar.requested_at,
         ar.manager_comment,
         u.id    AS user_id,
         u.email AS user_email,
         u.name  AS user_name,
         r.id    AS requested_role_id,
         r.name  AS requested_role_name
       FROM access_requests ar
       JOIN users u ON u.id = ar.user_id
       JOIN roles r ON r.id = ar.requested_role_id
       WHERE ar.manager_id = $1
       ORDER BY ar.requested_at DESC`,
      [req.user.id]
    );

    const shaped = rows.map((row) => ({
      id: row.id,
      user: { id: row.user_id, name: row.user_name, email: row.user_email },
      requestedRole: { id: row.requested_role_id, name: row.requested_role_name },
      status: row.status,
      requestedAt: row.requested_at,
      managerComment: row.manager_comment,
    }));

    res.json(shaped);
  } catch (err) {
    console.error('Error fetching manager access requests:', err);
    res.status(500).json({ error: 'Failed to fetch access requests' });
  }
});

// PUT /manager/access-requests/:id
// Body: { decision: 'approved' | 'rejected', comment }
// approved -> PENDING_ADMIN (goes on to admin for final sign-off)
// rejected -> REJECTED (terminal — matches accessRequestsMe.routes.js's
// documented invariant that a manager rejection never reaches admin)
router.put('/access-requests/:id', requireAuth, requireRole('manager'), async (req, res) => {
  const { id } = req.params;
  const { decision, comment } = req.body;

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
  }

  try {
    const { rows: existingRows } = await pool.query(
      'SELECT id, manager_id, status, user_id, requested_role_id FROM access_requests WHERE id = $1',
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Access request not found' });
    }

    const existing = existingRows[0];

    // This manager must be the one the request was assigned to at creation
    // time (access_requests.manager_id — a snapshot, see Request.routes.js),
    // not just anyone currently holding the 'manager' role.
    if (Number(existing.manager_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "This request isn't assigned to you" });
    }

    if (existing.status !== 'PENDING_MANAGER') {
      return res.status(409).json({ error: 'This request has already been decided' });
    }

    const newStatus = decision === 'approved' ? 'PENDING_ADMIN' : 'REJECTED';

    const { rows } = await pool.query(
      `UPDATE access_requests
       SET status = $1, manager_decision_at = NOW(), manager_comment = $2
       WHERE id = $3
       RETURNING id, status, manager_decision_at, manager_comment`,
      [newStatus, comment ?? null, id]
    );

    // Pull the requester's name + the role they asked for so the audit log
    // shows a human-readable "who/what" instead of just the raw
    // access_request id.
    const { rows: contextRows } = await pool.query(
      `SELECT u.name AS user_name, r.name AS role_name
       FROM users u, roles r
       WHERE u.id = $1 AND r.id = $2`,
      [existing.user_id, existing.requested_role_id]
    );
    const requesterName = contextRows[0]?.user_name ?? `user:${existing.user_id}`;
    const roleName = contextRows[0]?.role_name ?? `role:${existing.requested_role_id}`;

    // CLAUDE.md: "Every permission check and admin action gets written to
    // audit_logs" — this is a manager decision, same convention.
    //
    // user_id is the actor (this manager); target_user_id is the requester
    // the decision was about — see Request.routes.js's GET
    // /admin/audit-logs, which shows target_user_id as the row's "user".
    await pool.query(
      `INSERT INTO audit_logs (user_id, target_user_id, action, resource, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        existing.user_id,
        decision === 'approved' ? 'MANAGER_APPROVED_REQUEST' : 'MANAGER_REJECTED_REQUEST',
        `access_request:${id} — ${requesterName} (${roleName})`,
        req.ip,
      ]
    );

    res.json({
      id: rows[0].id,
      status: rows[0].status,
      managerDecisionAt: rows[0].manager_decision_at,
      managerComment: rows[0].manager_comment,
    });
  } catch (err) {
    console.error('Error reviewing access request:', err);
    res.status(500).json({ error: 'Failed to review access request' });
  }
});

// GET /manager/leave-requests
// Response: [{ id, user: {...}, startDate, endDate, reason, status,
//              managerComment, decidedAt, requestedAt }]
// Every leave request assigned to this manager at all stages — same shape
// as GET /manager/access-requests above: Managerdashboard.jsx's
// LeaveRequestsReview filters status === 'PENDING', LeaveHistory filters
// status !== 'PENDING' from this same array.
router.get('/leave-requests', requireAuth, requireRole('manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         lr.id,
         lr.status,
         lr.start_date,
         lr.end_date,
         lr.reason,
         lr.manager_comment,
         lr.decided_at,
         lr.requested_at,
         u.id    AS user_id,
         u.email AS user_email,
         u.name  AS user_name
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE lr.manager_id = $1
       ORDER BY lr.requested_at DESC`,
      [req.user.id]
    );

    const shaped = rows.map((row) => ({
      id: row.id,
      user: { id: row.user_id, name: row.user_name, email: row.user_email },
      startDate: row.start_date,
      endDate: row.end_date,
      reason: row.reason,
      status: row.status,
      managerComment: row.manager_comment,
      decidedAt: row.decided_at,
      requestedAt: row.requested_at,
    }));

    res.json(shaped);
  } catch (err) {
    console.error('Error fetching manager leave requests:', err);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

// PUT /manager/leave-requests/:id
// Body: { decision: 'approved' | 'rejected', comment }
// PENDING -> APPROVED / REJECTED is terminal either way — no second
// (admin) stage, unlike access_requests. Same ownership/status-guard
// pattern as PUT /manager/access-requests/:id above.
router.put('/leave-requests/:id', requireAuth, requireRole('manager'), async (req, res) => {
  const { id } = req.params;
  const { decision, comment } = req.body;

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
  }

  try {
    const { rows: existingRows } = await pool.query(
      'SELECT id, manager_id, status, user_id FROM leave_requests WHERE id = $1',
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const existing = existingRows[0];

    if (Number(existing.manager_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "This request isn't assigned to you" });
    }

    if (existing.status !== 'PENDING') {
      return res.status(409).json({ error: 'This request has already been decided' });
    }

    const newStatus = decision === 'approved' ? 'APPROVED' : 'REJECTED';

    const { rows } = await pool.query(
      `UPDATE leave_requests
       SET status = $1, decided_at = NOW(), manager_comment = $2
       WHERE id = $3
       RETURNING id, status, decided_at, manager_comment`,
      [newStatus, comment ?? null, id]
    );

    // user_id is the actor (this manager); target_user_id is the employee
    // whose leave was decided — same convention as MANAGER_APPROVED_REQUEST.
    await pool.query(
      `INSERT INTO audit_logs (user_id, target_user_id, action, resource, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        existing.user_id,
        decision === 'approved' ? 'MANAGER_APPROVED_LEAVE' : 'MANAGER_REJECTED_LEAVE',
        `leave_request:${id}`,
        req.ip,
      ]
    );

    res.json({
      id: rows[0].id,
      status: rows[0].status,
      decidedAt: rows[0].decided_at,
      managerComment: rows[0].manager_comment,
    });
  } catch (err) {
    console.error('Error reviewing leave request:', err);
    res.status(500).json({ error: 'Failed to review leave request' });
  }
});

// GET /manager/overview
// Response: { totalEmployees, presentToday, onLeaveToday, pendingTasks }
//
// onLeaveToday and pendingTasks depend on tables owned by Backend Dev 1
// (leave_requests) and Backend Dev 2 (tasks) respectively. Those tables may
// not exist yet (parallel work), so each sub-query is isolated in its own
// try/catch: if the table is missing (Postgres error code 42P01 —
// undefined_table) we don't want to fail the whole endpoint, we just report
// that stat as unavailable (null). Any other kind of error is rethrown to
// the outer catch, since that would be a real bug rather than a
// coordination race.
router.get('/overview', requireAuth, requireRole('manager'), async (req, res) => {
  try {
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE manager_id = $1`,
      [req.user.id]
    );
    const totalEmployees = totalRows[0].count;

    let onLeaveToday = null;
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM leave_requests
         WHERE manager_id = $1
           AND status = 'APPROVED'
           AND $2::date BETWEEN start_date AND end_date`,
        [req.user.id, new Date()]
      );
      onLeaveToday = rows[0].count;
    } catch (err) {
      if (err.code === '42P01') {
        // leave_requests doesn't exist yet — Backend Dev 1's table isn't
        // merged. Stub with null rather than blocking this endpoint.
        onLeaveToday = null;
      } else {
        throw err;
      }
    }

    // presentToday is a simple derived approximation (totalEmployees minus
    // employees on approved leave today) — there's no real attendance/
    // check-in system to source this from. If onLeaveToday couldn't be
    // computed (table not ready), presentToday can't be derived either.
    const presentToday = onLeaveToday === null ? null : totalEmployees - onLeaveToday;

    let pendingTasks = null;
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM tasks
         WHERE assigned_by = $1
           AND status != 'done'`,
        [req.user.id]
      );
      pendingTasks = rows[0].count;
    } catch (err) {
      if (err.code === '42P01') {
        // tasks doesn't exist yet — Backend Dev 2's table isn't merged.
        pendingTasks = null;
      } else {
        throw err;
      }
    }

    res.json({ totalEmployees, presentToday, onLeaveToday, pendingTasks });
  } catch (err) {
    console.error('Error fetching manager overview:', err);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

export default router;