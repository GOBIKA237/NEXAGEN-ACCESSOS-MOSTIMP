// Uses Node's built-in test runner (`node --test`) — no new dependency
// needed for this. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { pool } = await import('../src/config/db.js');
const { default: express } = await import('express');
const { default: rbacRouter } = await import('../src/routes/rbac.routes.js');

test('PUT /users/:id/roles returns 409 with conflict details when 2+ assigned roles both grant manage_users', async (t) => {
  // pool.query is mocked so this test never touches a real database.
  // requireAuth still runs for real (verifies an actual signed JWT) and
  // checkPermission still runs for real too — only the DB layer is faked.
  t.mock.method(pool, 'query', async (sql) => {
    const text = typeof sql === 'string' ? sql : sql.text;

    // requireAuth's tokens_invalid_before lookup (middleware/auth.js) — runs
    // before checkPermission on every authenticated route. Caller has never
    // had a forced session invalidation, so this comes back NULL.
    if (text.includes('SELECT tokens_invalid_before FROM users')) {
      return { rows: [{ tokens_invalid_before: null }] };
    }
    // checkPermission('manage_users') looking up the caller's own permissions
    if (text.includes('FROM user_roles ur') && text.includes('role_permissions rp')) {
      return { rows: [{ '?column?': 1 }] }; // caller is allowed
    }
    // checkPermission's audit log write
    if (text.includes('INSERT INTO audit_logs')) {
      return { rows: [] };
    }
    // the route's own overlap-detection query
    if (text.includes('GROUP BY p.name') && text.includes('HAVING COUNT')) {
      return { rows: [{ name: 'manage_users' }] }; // simulate a real overlap
    }

    throw new Error(`Unexpected query in test: ${text}`);
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin', rbacRouter);

  const server = app.listen(0);
  const { port } = server.address();
  const token = jwt.sign({ id: 1, email: 'admin@test.com' }, process.env.JWT_SECRET);

  try {
    const res = await fetch(`http://localhost:${port}/api/admin/users/2/roles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ roleIds: [1, 3] }), // two roles both granting manage_users
    });

    assert.equal(res.status, 409);

    const body = await res.json();
    assert.equal(body.conflict, true);
    assert.ok(Array.isArray(body.overlappingPermissions));
    assert.ok(body.overlappingPermissions.includes('manage_users'));
  } finally {
    server.close();
  }
});