import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

// Owned by Backend Dev 1. Split into its own tiny router (rather than
// added to Request.routes.js) so this doesn't touch a file owned by
// Backend Dev 2 — mounted separately in index.js at /api/access-requests
// to land on the exact path the frontend already calls
// (frontend/src/api/client.js -> getMyAccessRequests -> GET /access-requests/me).
//
// Reuses requireAuth + the existing access_requests/roles tables — no new
// auth or user system. The user is identified from req.user.id (JWT),
// never from a param or body, so there's no way to fetch someone else's
// requests by guessing an id.
const router = Router();

// GET /access-requests/me
// Response 200: [{ id, resource, requestedAccess, requestedAt, status,
//                   managerDecision: { decision, comment, decidedAt } | null,
//                   adminDecision:   { decision, comment, decidedAt } | null }]
//
// Shape matches frontend/src/api/mockData.js's mockMyAccessRequests, which
// is the documented contract Dashboard.jsx's "My requests" table already
// renders against.
//
// `resource` / `requestedAccess`: access_requests only stores a
// requested_role_id (see docs/schema.sql), not a separate "resource" —
// there's no dedicated resource/feature table it could reference instead.
// resource is the role's description (falling back to its name for roles
// without one); requestedAccess is the role name itself (e.g. 'finance').
// If Dev 2 or the frontend team wants resource tied 1:1 to a dashboard
// card title instead, that's a quick change here — ping the team.
//
// managerDecision / adminDecision: there's no separate "manager approved /
// manager rejected" flag column — only manager_decision_at (when) and
// manager_comment (what they said). The decision itself is inferred from
// where the request ended up:
//   - manager_decision_at set + status = REJECTED + admin never touched it
//     (reviewed_at IS NULL)  -> manager REJECTED (terminal, never reaches admin)
//   - manager_decision_at set + anything else                -> manager APPROVED
//     (the only way to reach PENDING_ADMIN/APPROVED/admin-REJECTED/REVOKED
//      is for the manager to have approved first)
// adminDecision mirrors this using reviewed_at/reviewed_by (existing
// columns, now the second-stage decision) + the new admin_comment column;
// its `decision` is just the current status once reviewed_at is set
// (APPROVED / REJECTED / REVOKED).
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         ar.id,
         COALESCE(r.description, r.name) AS resource,
         r.name                          AS requested_access,
         ar.requested_at,
         ar.status,
         ar.manager_decision_at,
         ar.manager_comment,
         ar.reviewed_at                  AS admin_decision_at,
         ar.admin_comment
       FROM access_requests ar
       JOIN roles r ON r.id = ar.requested_role_id
       WHERE ar.user_id = $1
       ORDER BY ar.requested_at DESC`,
      [req.user.id]
    );

    const shaped = rows.map((row) => {
      let managerDecision = null;
      if (row.manager_decision_at) {
        const rejectedByManager = row.status === 'REJECTED' && !row.admin_decision_at;
        managerDecision = {
          decision: rejectedByManager ? 'REJECTED' : 'APPROVED',
          comment: row.manager_comment,
          decidedAt: row.manager_decision_at,
        };
      }

      let adminDecision = null;
      if (row.admin_decision_at) {
        adminDecision = {
          decision: row.status, // APPROVED | REJECTED | REVOKED
          comment: row.admin_comment,
          decidedAt: row.admin_decision_at,
        };
      }

      return {
        id: row.id,
        resource: row.resource,
        requestedAccess: row.requested_access,
        requestedAt: row.requested_at,
        status: row.status,
        managerDecision,
        adminDecision,
      };
    });

    res.json(shaped);
  } catch (err) {
    console.error('Error fetching my access requests:', err);
    res.status(500).json({ error: 'Failed to fetch your access requests' });
  }
});

export default router;