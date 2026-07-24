import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /leave-requests
// Any authenticated user. Body: { startDate, endDate, reason }
//
// manager_id is a snapshot of the requester's manager at request time —
// same pattern as Request.routes.js's POST /access-requests. If the
// requester's manager changes later, this request stays with whoever it
// was assigned to when submitted.
router.post('/leave-requests', requireAuth, async (req, res) => {
  const { startDate, endDate, reason } = req.body;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({ error: 'startDate and endDate must be valid dates' });
  }

  if (end < start) {
    return res.status(400).json({ error: 'endDate must be on or after startDate' });
  }

  try {
    const { rows: userRows } = await pool.query(
      'SELECT manager_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const managerId = userRows[0]?.manager_id ?? null;

    const { rows } = await pool.query(
      `INSERT INTO leave_requests (user_id, manager_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, manager_id, start_date, end_date, reason, status, requested_at`,
      [req.user.id, managerId, startDate, endDate, reason ?? null]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating leave request:', err);
    return res.status(500).json({ error: 'Failed to create leave request' });
  }
});

// GET /leave-requests/me
// Any authenticated user. Their own leave history, most recent first.
router.get('/leave-requests/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, start_date, end_date, reason, status, manager_comment,
              decided_at, requested_at
       FROM leave_requests
       WHERE user_id = $1
       ORDER BY requested_at DESC`,
      [req.user.id]
    );

    const shaped = rows.map((row) => ({
      id: row.id,
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
    console.error('Error fetching leave requests:', err);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

export default router;