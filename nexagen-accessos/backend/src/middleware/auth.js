import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

// Verifies the JWT and attaches { id, email } to req.user.
// Owned by Backend Dev 1 — extend as needed (e.g. token refresh).
//
// Also enforces users.tokens_invalid_before (see docs/schema.sql): when an
// admin responds to a high-risk alert via
// POST /admin/alerts/:id/invalidate-session (docs/api-contract.md), that
// route stamps this column so the user's *existing* token(s) stop working
// immediately, without waiting for natural JWT expiry. This was previously
// a schema-only promise — the column existed but nothing here ever checked
// it, so a forced logout didn't actually do anything until the token
// expired on its own. Fixed by comparing the token's `iat` (issued-at,
// seconds since epoch — set automatically by jwt.sign) against the
// timestamp stamped on the user's row.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed token' });
  }

  const token = header.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT tokens_invalid_before FROM users WHERE id = $1',
      [payload.id]
    );
    const user = rows[0];

    // User row is gone (deleted after the token was issued) — treat like
    // any other invalid token rather than letting a stale JWT through.
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (user.tokens_invalid_before) {
      const invalidBeforeMs = new Date(user.tokens_invalid_before).getTime();
      const issuedAtMs = payload.iat * 1000;
      if (issuedAtMs < invalidBeforeMs) {
        return res.status(401).json({ error: 'Session invalidated, please log in again' });
      }
    }

    req.user = payload; // { id, email, iat, exp }
    next();
  } catch (err) {
    console.error('requireAuth error', err);
    return res.status(500).json({ error: 'Internal error verifying session' });
  }
}